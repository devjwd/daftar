import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, normalizeAddress, verifyAdminRequest } from '../_shared/admin.ts'
import { evaluateRule } from '../_shared/badgeEvaluation.ts'
import { signMintAuthorization } from '../_shared/signing.ts'

const SIGNATURE_TTL_MINUTES = 30

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, req)
  }

  const walletAddress = normalizeAddress(body.walletAddress ?? body.wallet_address)
  const onChainBadgeId = body.onChainBadgeId != null ? Number(body.onChainBadgeId) : null
  const internalBadgeId = body.badgeId ?? body.badge_id

  if (!walletAddress) {
    return jsonResponse({ error: 'walletAddress is required' }, 400, req)
  }

  // 1. Resolve Badge Definition
  let badgeQuery = supabase.from('badge_definitions').select('*')
  if (onChainBadgeId !== null) {
    badgeQuery = badgeQuery.eq('on_chain_badge_id', onChainBadgeId)
  } else if (internalBadgeId) {
    badgeQuery = badgeQuery.eq('badge_id', internalBadgeId)
  } else {
    return jsonResponse({ error: 'badgeId or onChainBadgeId is required' }, 400, req)
  }

  const { data: badge, error: badgeError } = await badgeQuery.maybeSingle()
  if (badgeError || !badge) {
    return jsonResponse({ error: badgeError?.message || 'Badge definition not found' }, 404, req)
  }

  // 2. Security Check: Admin vs User flow
  // If it's a manual award (no onChainBadgeId provided, or specifically requested as award), require admin auth.
  // BUT if it's a signature request for on-chain minting, we use server-side verification.
  const isSignatureRequest = onChainBadgeId !== null

  if (!isSignatureRequest) {
    const auth = await verifyAdminRequest(req, body, 'award-badge')
    if (!auth.ok) return auth.response
  }

  // 3. Evaluate Eligibility (Server-side Source of Truth)
  const { data: attestation } = await supabase
    .from('badge_attestations')
    .select('*')
    .eq('wallet_address', walletAddress)
    .eq('badge_id', badge.badge_id)
    .maybeSingle()

  try {
    const evaluation = await evaluateRule(supabase, walletAddress, badge, attestation)
    
    if (!evaluation.eligible) {
      return jsonResponse({ 
        error: 'Not eligible for this badge', 
        reason: evaluation.reason,
        eligible: false 
      }, 403, req)
    }

    // 4. Generate Move Signature (Required for on-chain minting or verification)
    const privateKey = Deno.env.get('BADGE_SIGNER_PRIVATE_KEY')
    const moduleAddress = Deno.env.get('BADGE_MODULE_ADDRESS')

    if (!privateKey || !moduleAddress) {
      return jsonResponse({ 
        error: 'Server configuration error (missing signer keys or module address)',
        details: 'Please contact admin to configure BADGE_SIGNER_PRIVATE_KEY and BADGE_MODULE_ADDRESS'
      }, 500, req)
    }

    // Fetch signer_epoch from on-chain Registry
    let signerEpoch = 0
    try {
      const fullnodeUrl = Deno.env.get('MOVEMENT_RPC_URL') || (String(Deno.env.get('VITE_NETWORK') || '').toLowerCase() === 'testnet' ? 'https://testnet.movementnetwork.xyz/v1' : 'https://mainnet.movementnetwork.xyz/v1')
      const resourceType = `${normalizeAddress(moduleAddress)}::badges::BadgeRegistry`
      const resp = await fetch(`${fullnodeUrl}/accounts/${normalizeAddress(moduleAddress)}/resource/${resourceType}`)
      if (resp.ok) {
        const resource = await resp.json()
        signerEpoch = Number(resource?.data?.signer_epoch ?? 0)
      }
    } catch (epochError) {
      console.warn('Failed to fetch signer_epoch, falling back to 0:', epochError)
    }

    const validUntil = Math.floor(Date.now() / 1000) + (SIGNATURE_TTL_MINUTES * 60)
    
    const sigData = await signMintAuthorization(
      privateKey,
      moduleAddress,
      walletAddress,
      badge.on_chain_badge_id,
      validUntil,
      signerEpoch
    )

    // 5. Record/Update Attestation in DB with cryptographic proof_hash
    // We store the hash of the signature as the proof_hash to wire the DB record to the crypto claim.
    const signatureHex = sigData.signatureBytes.map(b => b.toString(16).padStart(2, '0')).join('')
    const proofHash = `sig:${signatureHex.slice(0, 32)}` // Using a slice of the signature as a verifiable link

    const { error: upsertError } = await supabase.from('badge_attestations').upsert(
      {
        wallet_address: walletAddress,
        badge_id: badge.badge_id,
        eligible: true,
        verified_at: new Date().toISOString(),
        proof_hash: proofHash,
      },
      { onConflict: 'wallet_address,badge_id' }
    )

    if (upsertError) {
      console.error('Attestation upsert failed:', upsertError)
    }

    if (isSignatureRequest) {
      return jsonResponse({
        success: true,
        eligible: true,
        ...sigData
      }, 200, req)
    }

    return jsonResponse({ 
      success: true, 
      wallet_address: walletAddress, 
      badge_id: badge.badge_id,
      eligible: true 
    }, 200, req)

  } catch (evalError) {
    console.error('Evaluation error:', evalError)
    return jsonResponse({ error: 'Eligibility check failed', message: evalError.message }, 500, req)
  }
})