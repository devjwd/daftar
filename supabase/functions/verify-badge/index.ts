import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { BADGE_RULES, normalizeRuleType, validateRuleParams } from '../_shared/badgeValidation.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VERIFIED_CACHE_TTL_MS = 5 * 60 * 1000
const GENERIC_VERIFY_ERROR = 'Verification failed'

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const normalizeAddress = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  const withPrefix = raw.startsWith('0x') ? raw.slice(2) : raw
  if (!/^[0-9a-f]+$/i.test(withPrefix)) return ''
  return `0x${withPrefix.padStart(64, '0')}`
}

const normalizeBadgeId = (value: unknown) => String(value ?? '').trim()

const isFresh = (timestamp: string | null | undefined) => {
  if (!timestamp) return false
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) && Date.now() - parsed <= VERIFIED_CACHE_TTL_MS
}

const asObject = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})

const evaluateRule = async (
  supabase: ReturnType<typeof createClient>,
  walletAddress: string,
  badge: Record<string, unknown>,
  cachedAttestation: Record<string, unknown> | null,
): Promise<{ eligible: boolean; reason: string; fromCache: boolean }> => {
  if (cachedAttestation && cachedAttestation.eligible === true && isFresh(String(cachedAttestation.verified_at ?? ''))) {
    return { eligible: true, reason: 'cached', fromCache: true }
  }

  const ruleType = normalizeRuleType(badge.rule_type) ?? BADGE_RULES.ATTESTATION
  const paramsResult = validateRuleParams(ruleType, badge.rule_params)
  if (!paramsResult.ok) {
    throw new Error(paramsResult.error)
  }

  const ruleParams = asObject(paramsResult.ruleParams)

  if (ruleType === BADGE_RULES.ALLOWLIST || ruleType === BADGE_RULES.ATTESTATION) {
    return {
      eligible: cachedAttestation?.eligible === true,
      reason: cachedAttestation?.eligible === true ? 'manual-attestation' : 'requires-manual-attestation',
      fromCache: cachedAttestation?.eligible === true,
    }
  }

  if (ruleType === BADGE_RULES.MIN_BALANCE) {
    return {
      eligible: cachedAttestation?.eligible === true,
      reason: cachedAttestation?.eligible === true ? 'cached-balance-attestation' : 'min-balance-not-verified-server-side',
      fromCache: cachedAttestation?.eligible === true,
    }
  }

  const { data: transactions, error } = await supabase
    .from('transaction_history')
    .select('wallet_address, dapp_key, dapp_name, dapp_contract, tx_timestamp')
    .eq('wallet_address', walletAddress)
    .order('tx_timestamp', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  const rows = Array.isArray(transactions) ? transactions : []

  if (ruleType === BADGE_RULES.TX_COUNT) {
    const minCount = Math.max(1, Number(ruleParams.min_count ?? 1) || 1)
    return {
      eligible: rows.length >= minCount,
      reason: rows.length >= minCount ? 'transaction-threshold-met' : 'transaction-threshold-not-met',
      fromCache: false,
    }
  }

  if (ruleType === BADGE_RULES.ACTIVE_DAYS) {
    const minDays = Math.max(1, Number(ruleParams.min_days ?? 1) || 1)
    const firstTimestamp = rows[0]?.tx_timestamp ? Date.parse(String(rows[0].tx_timestamp)) : Number.NaN
    const activeDays = Number.isFinite(firstTimestamp)
      ? Math.floor((Date.now() - firstTimestamp) / 86_400_000)
      : 0
    return {
      eligible: activeDays >= minDays,
      reason: activeDays >= minDays ? 'active-days-threshold-met' : 'active-days-threshold-not-met',
      fromCache: false,
    }
  }

  if (ruleType === BADGE_RULES.PROTOCOL_COUNT) {
    const minProtocols = Math.max(1, Number(ruleParams.min_protocols ?? 1) || 1)
    const uniqueProtocols = new Set(
      rows
        .map((row) => String(row?.dapp_key || row?.dapp_name || row?.dapp_contract || '').trim().toLowerCase())
        .filter(Boolean),
    )
    return {
      eligible: uniqueProtocols.size >= minProtocols,
      reason: uniqueProtocols.size >= minProtocols ? 'protocol-threshold-met' : 'protocol-threshold-not-met',
      fromCache: false,
    }
  }

  if (ruleType === BADGE_RULES.DAPP_USAGE) {
    const dappKey = String(ruleParams.dapp_key ?? '').trim().toLowerCase()
    const dappName = String(ruleParams.dapp_name ?? '').trim().toLowerCase()
    const dappContract = String(ruleParams.dapp_contract ?? '').trim().toLowerCase()
    const eligible = rows.some((row) => {
      const rowKey = String(row?.dapp_key ?? '').trim().toLowerCase()
      const rowName = String(row?.dapp_name ?? '').trim().toLowerCase()
      const rowContract = String(row?.dapp_contract ?? '').trim().toLowerCase()
      return Boolean(
        (dappKey && rowKey === dappKey)
          || (dappName && rowName === dappName)
          || (dappContract && rowContract === dappContract),
      )
    })
    return {
      eligible,
      reason: eligible ? 'dapp-usage-found' : 'dapp-usage-not-found',
      fromCache: false,
    }
  }

  return {
    eligible: cachedAttestation?.eligible === true,
    reason: cachedAttestation?.eligible === true ? 'cached-unsupported-rule' : 'unsupported-rule',
    fromCache: cachedAttestation?.eligible === true,
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

  const walletAddress = normalizeAddress(body.wallet_address)
  const badgeId = normalizeBadgeId(body.badge_id)

  if (!walletAddress || !badgeId) {
    return jsonResponse({ error: 'wallet_address and badge_id are required' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: cachedAttestation } = await supabase
    .from('badge_attestations')
    .select('wallet_address, badge_id, eligible, verified_at')
    .eq('wallet_address', walletAddress)
    .eq('badge_id', badgeId)
    .maybeSingle()

  const { data: badge } = await supabase
    .from('badge_definitions')
    .select('*')
    .eq('badge_id', badgeId)
    .eq('is_active', true)
    .single()

  if (!badge) {
    return jsonResponse({ error: 'Badge not found' }, 404)
  }

  let evaluation
  try {
    evaluation = await evaluateRule(supabase, walletAddress, badge, cachedAttestation as Record<string, unknown> | null)
  } catch (error) {
    console.error('[verify-badge] evaluation failed', error)
    return jsonResponse({ error: GENERIC_VERIFY_ERROR }, 500)
  }

  await supabase.from('badge_attestations').upsert(
    {
      wallet_address: walletAddress,
      badge_id: badgeId,
      eligible: evaluation.eligible,
      verified_at: new Date().toISOString(),
    },
    { onConflict: 'wallet_address,badge_id' }
  )

  return jsonResponse({
    eligible: evaluation.eligible,
    badge_id: badgeId,
    wallet_address: walletAddress,
    reason: evaluation.reason,
    cached: evaluation.fromCache,
  })
})