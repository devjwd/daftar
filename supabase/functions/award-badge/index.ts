import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Ed25519PublicKey, Ed25519Signature } from 'https://esm.sh/@aptos-labs/ts-sdk@1.3.0'
import { corsHeaders, jsonResponse, normalizeAddress, verifyAdminRequest } from '../_shared/admin.ts'

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const parseSignaturePayload = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value))
    } catch {
      return null
    }
  }

  return asObject(value)
}

const normalizeCompactAddress = (value: unknown) => {
  const normalized = normalizeAddress(value)
  if (!normalized) return ''
  const withoutPrefix = normalized.slice(2).replace(/^0+/, '') || '0'
  return `0x${withoutPrefix}`
}

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const verifyWalletSignature = (
  walletAddress: string,
  message: string,
  signaturePayload: unknown,
) => {
  const parsed = parseSignaturePayload(signaturePayload)
  const publicKeyHex = String(parsed?.publicKey ?? parsed?.public_key ?? '').trim()
  const signatureHex = String(parsed?.signature ?? parsed?.sig ?? '').trim()

  if (!walletAddress || !message || !publicKeyHex || !signatureHex) {
    return false
  }

  try {
    const publicKey = new Ed25519PublicKey(publicKeyHex)
    const signature = new Ed25519Signature(signatureHex)
    const verified = publicKey.verifySignature({
      message: new TextEncoder().encode(message),
      signature,
    })

    if (!verified) return false

    const signerAddress = normalizeCompactAddress(String(publicKey.authKey().derivedAddress()))
    return signerAddress === normalizeCompactAddress(walletAddress)
  } catch {
    return false
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const auth = await verifyAdminRequest(req, body, 'award-badge')
  if (!auth.ok) return auth.response

  const walletAddress = normalizeAddress(body.wallet_address ?? body.walletAddress)
  const badgeId = String(body.badge_id ?? '').trim()
  const signedMessage = String(body.signedMessage ?? '').trim()
  const signature = body.signature

  if (!walletAddress || !badgeId || !signedMessage || !signature) {
    return jsonResponse({ error: 'walletAddress, signedMessage, signature, and badge_id are required' }, 400)
  }

  if (!verifyWalletSignature(walletAddress, signedMessage, signature)) {
    return jsonResponse({ error: 'Invalid wallet signature' }, 401)
  }

  const proofHash = await sha256Hex(signedMessage)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await supabase.from('badge_attestations').upsert(
    {
      wallet_address: walletAddress,
      badge_id: badgeId,
      eligible: true,
      verified_at: new Date().toISOString(),
      proof_hash: proofHash,
    },
    { onConflict: 'wallet_address,badge_id' }
  )

  if (error) {
    return jsonResponse({ error: error.message }, 500)
  }

  return jsonResponse({ success: true, wallet_address: walletAddress, badge_id: badgeId })
})