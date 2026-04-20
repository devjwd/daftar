import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { BADGE_RULES, normalizeRuleType, validateRuleParams } from '../_shared/badgeValidation.ts'

const splitCsv = (value: string | null | undefined) =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

const getAllowedOrigins = () => {
  const env = Deno.env.get('BADGE_CORS_ORIGIN') ?? Deno.env.get('API_CORS_ORIGIN') ?? ''
  const allowed = splitCsv(env)
  if (allowed.length > 0) return allowed

  // Safe defaults for local dev.
  return ['http://localhost:5173', 'http://localhost:3000']
}


const getCorsHeaders = (req: Request) => {
  const allowedOrigins = getAllowedOrigins()
  const requestOrigin = req.headers.get('origin')?.trim() ?? ''
  const origin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0] ?? 'null'

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const VERIFIED_CACHE_TTL_MS = 5 * 60 * 1000
const GENERIC_VERIFY_ERROR = 'Verification failed'

const NETWORKS = {
  mainnet: 'https://mainnet.movementnetwork.xyz/v1',
  testnet: 'https://testnet.movementnetwork.xyz/v1',
}

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const normalizeAddress = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  const withPrefix = raw.startsWith('0x') ? raw.slice(2) : raw
  if (!/^[0-9a-f]+$/i.test(withPrefix)) return ''
  return `0x${withPrefix.padStart(64, '0')}`
}

const normalizeBadgeId = (value: unknown) => String(value ?? '').trim()

const isNonNegativeIntegerString = (value: string) => /^\d+$/.test(value)

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

import { evaluateRule } from '../_shared/badgeEvaluation.ts'
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const requiredApiKey = String(Deno.env.get('VERIFY_BADGE_API_KEY') ?? '').trim()
  if (requiredApiKey) {
    const provided = String(req.headers.get('x-api-key') ?? '').trim()
    if (!provided || provided !== requiredApiKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const walletAddress = normalizeAddress(body.wallet_address)
  const requestedBadgeId = normalizeBadgeId(body.badge_id)

  if (!walletAddress || !requestedBadgeId) {
    return new Response(JSON.stringify({ error: 'wallet_address and badge_id are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let badge: Record<string, unknown> | null = null
  let badgeQueryError: { message?: string } | null = null

  const badgeById = await supabase
    .from('badge_definitions')
    .select('*')
    .eq('badge_id', requestedBadgeId)
    .eq('is_active', true)
    .maybeSingle()

  if (badgeById.error) {
    badgeQueryError = badgeById.error
  } else if (badgeById.data) {
    badge = badgeById.data as Record<string, unknown>
  }

  if (!badge && isNonNegativeIntegerString(requestedBadgeId)) {
    const onChainBadgeId = Number(requestedBadgeId)
    const badgeByOnChain = await supabase
      .from('badge_definitions')
      .select('*')
      .eq('on_chain_badge_id', onChainBadgeId)
      .eq('is_active', true)
      .maybeSingle()

    if (badgeByOnChain.error) {
      badgeQueryError = badgeByOnChain.error
    } else if (badgeByOnChain.data) {
      badge = badgeByOnChain.data as Record<string, unknown>
    }
  }

  if (!badge && badgeQueryError?.message) {
    return new Response(JSON.stringify({ error: GENERIC_VERIFY_ERROR }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!badge) {
    return new Response(JSON.stringify({ error: 'Badge not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const badgeId = String(badge.badge_id ?? '').trim()
  if (!badgeId) {
    return new Response(JSON.stringify({ error: GENERIC_VERIFY_ERROR }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: cachedAttestation } = await supabase
    .from('badge_attestations')
    .select('wallet_address, badge_id, eligible, verified_at')
    .eq('wallet_address', walletAddress)
    .eq('badge_id', badgeId)
    .maybeSingle()

  // --- ANTI-SPAM RATE LIMITER ---
  const MIN_REQUEST_INTERVAL_MS = 10000; // 10 seconds
  if (cachedAttestation?.verified_at) {
    const lastRequestTime = Date.parse(cachedAttestation.verified_at);
    if (Date.now() - lastRequestTime < MIN_REQUEST_INTERVAL_MS) {
      console.warn(`[verify-badge] Rate limit hit for ${walletAddress} on badge ${badgeId}`);
      return new Response(JSON.stringify({ 
        error: 'Too many requests. Please wait a few seconds before re-verifying.',
        retry_after_ms: MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestTime)
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  let evaluation
  try {
    evaluation = await evaluateRule(supabase, walletAddress, badge, cachedAttestation as Record<string, unknown> | null)
  } catch (error) {
    console.error('[verify-badge] evaluation failed', error)
    return new Response(JSON.stringify({ error: GENERIC_VERIFY_ERROR }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const proofHash = evaluation.eligible
    ? await sha256Hex(`${walletAddress}:${badgeId}:${evaluation.reason}:${Date.now()}`)
    : null

  await supabase.from('badge_attestations').upsert(
    {
      wallet_address: walletAddress,
      badge_id: badgeId,
      eligible: evaluation.eligible,
      verified_at: new Date().toISOString(),
      proof_hash: proofHash,
    },
    { onConflict: 'wallet_address,badge_id' }
  )

  return new Response(JSON.stringify({
    eligible: evaluation.eligible,
    badge_id: badgeId,
    wallet_address: walletAddress,
    reason: evaluation.reason,
    cached: evaluation.fromCache,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})