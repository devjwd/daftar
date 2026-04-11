export const BADGE_RULES = {
  ALLOWLIST: 1,
  MIN_BALANCE: 2,
  ATTESTATION: 3,
  TX_COUNT: 4,
  ACTIVE_DAYS: 5,
  PROTOCOL_COUNT: 6,
  DAPP_USAGE: 7,
  HOLDING_PERIOD: 8,
  NFT_HOLDER: 9,
  COMPOSITE: 10,
} as const

const VALID_RULE_TYPES = new Set<number>(Object.values(BADGE_RULES))
const VALID_RARITIES = new Set(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'])
const MAX_BADGE_ID_LENGTH = 120
const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500
const MAX_URL_LENGTH = 2_000
const MAX_CATEGORY_LENGTH = 50
const MAX_JSON_TEXT_LENGTH = 20_000
const MAX_CRITERIA_COUNT = 10

const asObject = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const ensureString = (value: unknown, fallback = '') => String(value ?? fallback).trim()

const ensureBoolean = (value: unknown, fallback = true) =>
  typeof value === 'boolean' ? value : fallback

const ensureIntegerInRange = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = Math.floor(parsed)
  return Math.min(max, Math.max(min, normalized))
}

const ensureNumberInRange = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const cloneJsonValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isHttpUrl = (value: string) => {
  if (!value) return false
  if (value.startsWith('data:') || value.startsWith('/')) return true

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const normalizeRuleType = (value: unknown): number | null => {
  if (typeof value === 'number' && VALID_RULE_TYPES.has(value)) {
    return value
  }

  const raw = ensureString(value).toLowerCase()
  const mapping: Record<string, number> = {
    allowlist: BADGE_RULES.ALLOWLIST,
    min_balance: BADGE_RULES.MIN_BALANCE,
    manual: BADGE_RULES.ATTESTATION,
    attestation: BADGE_RULES.ATTESTATION,
    transaction_count: BADGE_RULES.TX_COUNT,
    tx_count: BADGE_RULES.TX_COUNT,
    active_days: BADGE_RULES.ACTIVE_DAYS,
    days_onchain: BADGE_RULES.ACTIVE_DAYS,
    protocol_count: BADGE_RULES.PROTOCOL_COUNT,
    dapp_usage: BADGE_RULES.DAPP_USAGE,
    holding_period: BADGE_RULES.HOLDING_PERIOD,
    nft_holder: BADGE_RULES.NFT_HOLDER,
    composite: BADGE_RULES.COMPOSITE,
  }

  return mapping[raw] ?? null
}

const validateStringLength = (value: string, maxLength: number, label: string) => {
  if (value.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or less`)
  }
}

const validateJsonSize = (value: unknown, label: string) => {
  const text = JSON.stringify(value)
  if (text.length > MAX_JSON_TEXT_LENGTH) {
    throw new Error(`${label} is too large`)
  }
}

const sanitizeRuleCriteria = (value: unknown, allowComposite = true) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CRITERIA_COUNT) {
    throw new Error(`Composite criteria must contain between 1 and ${MAX_CRITERIA_COUNT} rules`)
  }

  return value.map((criterion) => {
    const item = asObject(criterion)
    const ruleType = normalizeRuleType(item.rule_type ?? item.type)
    if (!ruleType) {
      throw new Error('Composite rule contains an invalid rule_type')
    }

    if (!allowComposite && ruleType === BADGE_RULES.COMPOSITE) {
      throw new Error('Nested composite rules are not supported')
    }

    const paramsResult = validateRuleParams(ruleType, item.params ?? item.rule_params, false)
    if (!paramsResult.ok) {
      throw new Error(paramsResult.error)
    }

    return {
      type: ensureString(item.type || ''),
      rule_type: ruleType,
      params: paramsResult.ruleParams,
    }
  })
}

export const validateRuleParams = (
  ruleType: number,
  rawParams: unknown,
  allowComposite = true,
): { ok: true; ruleParams: Record<string, unknown> } | { ok: false; error: string } => {
  const params = asObject(rawParams)

  try {
    if (ruleType === BADGE_RULES.ALLOWLIST) {
      return { ok: true, ruleParams: { mode: 'allowlist' } }
    }

    if (ruleType === BADGE_RULES.ATTESTATION) {
      return { ok: true, ruleParams: { mode: ensureString(params.mode || 'manual') || 'manual' } }
    }

    if (ruleType === BADGE_RULES.MIN_BALANCE) {
      const coinType = ensureString(params.coin_type ?? params.coinType)
      if (!coinType) throw new Error('MIN_BALANCE requires rule_params.coin_type')
      validateStringLength(coinType, 200, 'rule_params.coin_type')
      return {
        ok: true,
        ruleParams: {
          coin_type: coinType,
          min_amount: ensureNumberInRange(params.min_amount ?? params.minAmount, 0, 1_000_000_000, 0),
          decimals: ensureIntegerInRange(params.decimals, 0, 18, 8),
        },
      }
    }

    if (ruleType === BADGE_RULES.TX_COUNT) {
      return {
        ok: true,
        ruleParams: {
          min_count: ensureIntegerInRange(params.min_count ?? params.minCount ?? params.count, 1, 1_000_000, 1),
        },
      }
    }

    if (ruleType === BADGE_RULES.ACTIVE_DAYS) {
      return {
        ok: true,
        ruleParams: {
          min_days: ensureIntegerInRange(params.min_days ?? params.minDays ?? params.days, 1, 3_650, 1),
        },
      }
    }

    if (ruleType === BADGE_RULES.PROTOCOL_COUNT) {
      return {
        ok: true,
        ruleParams: {
          min_protocols: ensureIntegerInRange(params.min_protocols ?? params.minProtocols ?? params.count, 1, 1_000, 1),
        },
      }
    }

    if (ruleType === BADGE_RULES.DAPP_USAGE) {
      const dappKey = ensureString(params.dapp_key ?? params.dappKey)
      const dappName = ensureString(params.dapp_name ?? params.dappName)
      const dappContract = ensureString(params.dapp_contract ?? params.dappContract)

      if (!dappKey && !dappName && !dappContract) {
        throw new Error('DAPP_USAGE requires at least one of dapp_key, dapp_name, or dapp_contract')
      }

      validateStringLength(dappKey, 120, 'rule_params.dapp_key')
      validateStringLength(dappName, 200, 'rule_params.dapp_name')
      validateStringLength(dappContract, 200, 'rule_params.dapp_contract')

      return {
        ok: true,
        ruleParams: {
          dapp_key: dappKey,
          dapp_name: dappName,
          dapp_contract: dappContract,
        },
      }
    }

    if (ruleType === BADGE_RULES.HOLDING_PERIOD) {
      const coinType = ensureString(params.coin_type ?? params.coinType)
      if (!coinType) throw new Error('HOLDING_PERIOD requires rule_params.coin_type')
      validateStringLength(coinType, 200, 'rule_params.coin_type')
      return {
        ok: true,
        ruleParams: {
          coin_type: coinType,
          min_amount: ensureNumberInRange(params.min_amount ?? params.minAmount, 0, 1_000_000_000, 0),
          min_days: ensureIntegerInRange(params.min_days ?? params.minDays ?? params.days, 1, 3_650, 1),
        },
      }
    }

    if (ruleType === BADGE_RULES.NFT_HOLDER) {
      const collectionName = ensureString(params.collection_name ?? params.collectionName)
      const collectionAddress = ensureString(params.collection_address ?? params.collectionAddress)
      if (!collectionName && !collectionAddress) {
        throw new Error('NFT_HOLDER requires collection_name or collection_address')
      }

      validateStringLength(collectionName, 200, 'rule_params.collection_name')
      validateStringLength(collectionAddress, 200, 'rule_params.collection_address')

      return {
        ok: true,
        ruleParams: {
          collection_name: collectionName,
          collection_address: collectionAddress,
          min_count: ensureIntegerInRange(params.min_count ?? params.minCount, 1, 10_000, 1),
        },
      }
    }

    if (ruleType === BADGE_RULES.COMPOSITE) {
      const criteria = sanitizeRuleCriteria(params.criteria, allowComposite)
      const operatorRaw = ensureString(params.operator || 'AND').toUpperCase()
      const operator = operatorRaw === 'OR' ? 'OR' : 'AND'
      return {
        ok: true,
        ruleParams: {
          operator,
          criteria,
        },
      }
    }

    return { ok: false, error: 'Unsupported rule type' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid rule parameters' }
  }
}

export const validateBadgeDefinitionPayload = (
  value: unknown,
): { ok: true; badgeId: string; badge: Record<string, unknown> } | { ok: false; error: string } => {
  const badge = asObject(value)
  const badgeId = ensureString(badge.badge_id ?? badge.id)
  const name = ensureString(badge.name)
  const description = ensureString(badge.description)
  const imageUrl = ensureString(badge.image_url ?? badge.imageUrl)
  const category = ensureString(badge.category || 'activity').toLowerCase()
  const rarity = ensureString(badge.rarity || 'COMMON').toUpperCase()
  const ruleType = normalizeRuleType(badge.rule_type)

  try {
    if (!badgeId) throw new Error('badge.badge_id is required')
    if (badgeId.length > MAX_BADGE_ID_LENGTH) throw new Error(`badge.badge_id must be ${MAX_BADGE_ID_LENGTH} characters or less`)
    if (!/^[a-zA-Z0-9:_-]+$/.test(badgeId)) throw new Error('badge.badge_id contains invalid characters')
    if (name.length < 2) throw new Error('badge.name is required (min 2 chars)')
    validateStringLength(name, MAX_NAME_LENGTH, 'badge.name')
    validateStringLength(description, MAX_DESCRIPTION_LENGTH, 'badge.description')
    if (!imageUrl) throw new Error('badge.image_url is required')
    validateStringLength(imageUrl, MAX_URL_LENGTH, 'badge.image_url')
    if (!isHttpUrl(imageUrl)) throw new Error('badge.image_url must be an http(s), data URI, or root-relative URL')
    if (!category) throw new Error('badge.category is required')
    validateStringLength(category, MAX_CATEGORY_LENGTH, 'badge.category')
    if (!VALID_RARITIES.has(rarity)) throw new Error(`badge.rarity must be one of ${Array.from(VALID_RARITIES).join(', ')}`)
    if (!ruleType) throw new Error('badge.rule_type is required and must be valid')

    const ruleParamsResult = validateRuleParams(ruleType, badge.rule_params)
    if (!ruleParamsResult.ok) throw new Error(ruleParamsResult.error)

    const criteria = Array.isArray(badge.criteria) ? cloneJsonValue(badge.criteria) : []
    const metadata = cloneJsonValue(asObject(badge.metadata))
    validateJsonSize(criteria, 'badge.criteria')
    validateJsonSize(metadata, 'badge.metadata')

    const onChainBadgeIdRaw = badge.on_chain_badge_id ?? badge.onChainBadgeId
    const onChainBadgeId =
      onChainBadgeIdRaw == null || onChainBadgeIdRaw === ''
        ? null
        : ensureIntegerInRange(onChainBadgeIdRaw, 0, 1_000_000_000, 0)

    const xpValue = ensureIntegerInRange(badge.xp_value ?? badge.xp, 0, 1_000_000, 0)
    const mintFee = ensureNumberInRange(badge.mint_fee ?? badge.mintFee, 0, 1_000_000_000, 0)
    const isPublic = ensureBoolean(badge.is_public ?? badge.isPublic, true)
    const enabled = ensureBoolean(badge.enabled, true)

    return {
      ok: true,
      badgeId,
      badge: {
        badge_id: badgeId,
        name,
        description,
        image_url: imageUrl,
        category,
        rarity,
        xp_value: xpValue,
        mint_fee: mintFee,
        criteria,
        metadata,
        is_public: isPublic,
        enabled,
        is_active: enabled,
        rule_type: ruleType,
        rule_params: ruleParamsResult.ruleParams,
        on_chain_badge_id: onChainBadgeId,
      },
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid badge payload' }
  }
}

export const getSafeErrorMessage = (fallback: string) => {
  return fallback
}