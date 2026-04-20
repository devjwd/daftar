import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { BADGE_RULES, normalizeRuleType, validateRuleParams } from './badgeValidation.ts'

const VERIFIED_CACHE_TTL_MS = 5 * 60 * 1000

const NETWORKS = {
  mainnet: 'https://mainnet.movementnetwork.xyz/v1',
  testnet: 'https://testnet.movementnetwork.xyz/v1',
}

const asObject = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})

const normalizeAddress = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  const withPrefix = raw.startsWith('0x') ? raw.slice(2) : raw
  if (!/^[0-9a-f]+$/i.test(withPrefix)) return ''
  return `0x${withPrefix.padStart(64, '0')}`
}

export const isFresh = (timestamp: string | null | undefined) => {
  if (!timestamp) return false
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) && Date.now() - parsed <= VERIFIED_CACHE_TTL_MS
}

export const getFullnodeUrl = () => {
  const explicit = String(Deno.env.get('MOVEMENT_RPC_URL') ?? '').trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const network = String(Deno.env.get('VITE_NETWORK') ?? Deno.env.get('NETWORK') ?? 'mainnet').toLowerCase()
  return network === 'testnet' ? NETWORKS.testnet : NETWORKS.mainnet
}

export const parseCoinTypeOwnerAddress = (coinType: string) => {
  const [addr] = String(coinType || '').trim().split('::')
  const normalized = normalizeAddress(addr)
  return normalized || null
}

export const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init)
  const text = await response.text()
  const parsed = text ? JSON.parse(text) : null
  return { response, parsed }
}

export const fetchTokenBalance = async (walletAddress: string, ruleParams: Record<string, unknown>) => {
  const coinType = String(ruleParams.coin_type ?? '').trim()
  if (!coinType) throw new Error('MIN_BALANCE requires rule_params.coin_type')

  const fullnodeUrl = getFullnodeUrl()
  const view = await fetchJson(`${fullnodeUrl}/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      function: '0x1::coin::balance',
      type_arguments: [coinType],
      arguments: [walletAddress],
    }),
  })

  if (!view.response.ok) {
    throw new Error(`RPC balance lookup failed (${view.response.status})`)
  }

  const rawBalance = Array.isArray(view.parsed) ? Number(view.parsed[0] ?? 0) : 0
  let decimals = Number(ruleParams.decimals ?? 8)
  if (!Number.isFinite(decimals)) decimals = 8

  const ownerAddress = parseCoinTypeOwnerAddress(coinType)
  if (ownerAddress) {
    const resourceType = `0x1::coin::CoinInfo<${coinType}>`
    const resource = await fetchJson(`${fullnodeUrl}/accounts/${ownerAddress}/resource/${encodeURIComponent(resourceType)}`)
    if (resource.response.ok) {
      const nextDecimals = Number((resource.parsed as Record<string, unknown> | null)?.data?.decimals)
      if (Number.isFinite(nextDecimals)) {
        decimals = nextDecimals
      }
    }
  }

  return rawBalance / Math.pow(10, decimals)
}

export const evaluateRule = async (
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

  if (ruleType === BADGE_RULES.ALLOWLIST) {
    // High-efficiency SQL check for thousands of users
    const { data: isEligible, error: lookupError } = await supabase
      .from('badge_eligible_wallets')
      .select('wallet_address')
      .eq('badge_id', badge.id)
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (lookupError) throw new Error(`Allowlist lookup failed: ${lookupError.message}`);

    return {
      eligible: !!isEligible,
      reason: isEligible ? 'allowlist-verified' : 'not-in-allowlist',
      fromCache: false,
    };
  }

  if (ruleType === BADGE_RULES.ATTESTATION) {
    return {
      eligible: cachedAttestation?.eligible === true,
      reason: cachedAttestation?.eligible === true ? 'manual-attestation' : 'requires-manual-attestation',
      fromCache: cachedAttestation?.eligible === true,
    }
  }

  if (ruleType === BADGE_RULES.MIN_BALANCE) {
    const minAmount = Math.max(0, Number(ruleParams.min_amount ?? 0) || 0)
    const balance = await fetchTokenBalance(walletAddress, ruleParams)
    return {
      eligible: balance >= minAmount,
      reason: balance >= minAmount ? 'min-balance-threshold-met' : 'min-balance-threshold-not-met',
      fromCache: false,
    }
  }

  if (ruleType === BADGE_RULES.TX_COUNT) {
    const minCount = Math.max(1, Number(ruleParams.min_count ?? 1) || 1)
    const { count, error } = await supabase
      .from('transaction_history')
      .select('*', { count: 'exact', head: true })
      .eq('wallet_address', walletAddress)

    if (error) throw new Error(error.message)
    const currentCount = count || 0

    return {
      eligible: currentCount >= minCount,
      reason: currentCount >= minCount ? 'transaction-threshold-met' : 'transaction-threshold-not-met',
      fromCache: false,
    }
  }

  if (ruleType === BADGE_RULES.ACTIVE_DAYS) {
    const minDays = Math.max(1, Number(ruleParams.min_days ?? 1) || 1)
    const { data: firstTx, error } = await supabase
      .from('transaction_history')
      .select('tx_timestamp')
      .eq('wallet_address', walletAddress)
      .order('tx_timestamp', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    const firstTimestamp = firstTx?.tx_timestamp ? Date.parse(String(firstTx.tx_timestamp)) : Number.NaN
    const activeDays = Number.isFinite(firstTimestamp)
      ? Math.floor((Date.now() - firstTimestamp) / 86_400_000)
      : 0

    return {
      eligible: activeDays >= minDays,
      reason: activeDays >= minDays ? 'active-days-threshold-met' : 'active-days-threshold-not-met',
      fromCache: false,
    }
  }

  // For complex rules, still fetch transactions but apply a sensible limit to save costs
  const { data: transactions, error: txError } = await supabase
    .from('transaction_history')
    .select('dapp_key, dapp_name, dapp_contract')
    .eq('wallet_address', walletAddress)
    .limit(1000)

  if (txError) throw new Error(txError.message)
  const rows = Array.isArray(transactions) ? transactions : []

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
