/**
 * badgeEligibility.js — shared badge evaluation logic
 *
 * Extracted so both the read-only eligibility endpoint and the mint-signing
 * endpoint can run the same evaluation without duplicating rules or importing
 * each other.
 *
 * Exports:
 *   viewBool             — call a boolean on-chain view function
 *   evaluateRule         — evaluate a badge's rule against a wallet
 *   resolveBadgeDefinition — load a badge definition from state files or Supabase
 */

import {
  getTransactionCount,
  getDaysOnchain,
  getProtocolCount,
  getDappUsage,
  getDexVolume,
  getTokenBalance,
} from '../services/movementIndexer.js';
import { loadResolvedBadgeConfigs } from './badgeConfigsState.js';
import { loadResolvedBadgeDefinitions } from './badgeDefinitionsState.js';

export const RULE_TYPE_BY_NUMBER = {
  1: 'ALLOWLIST',
  2: 'MIN_BALANCE',
  3: 'ATTESTATION',
  4: 'TRANSACTION_COUNT',
  5: 'DAYS_ONCHAIN',
  6: 'PROTOCOL_COUNT',
  7: 'DAPP_USAGE',
  8: 'HOLDING_PERIOD',
  9: 'NFT_HOLDER',
  10: 'COMPOSITE',
};

export const RULE_TYPE_BY_CRITERION = {
  transaction_count: 'TRANSACTION_COUNT',
  days_onchain: 'DAYS_ONCHAIN',
  min_balance: 'MIN_BALANCE',
  protocol_count: 'PROTOCOL_COUNT',
  protocol_usage: 'DAPP_USAGE',
  dapp_usage: 'DAPP_USAGE',
  dex_volume: 'DEX_VOLUME',
  allowlist: 'ALLOWLIST',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const normalizeRuleType = (value) => {
  if (typeof value === 'number') return RULE_TYPE_BY_NUMBER[value] || '';
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return RULE_TYPE_BY_NUMBER[numeric] || '';
  return String(value || '').trim().toUpperCase();
};

const getNumberParam = (params, keys, fallback = 0) => {
  for (const key of keys) {
    if (params?.[key] !== undefined && params?.[key] !== null && params?.[key] !== '') {
      const numeric = Number(params[key]);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  return fallback;
};

const getStringParam = (params, keys) => {
  for (const key of keys) {
    const value = String(params?.[key] ?? '').trim();
    if (value) return value;
  }
  return '';
};

const getOnChainBadgeId = (value) => {
  const badgeId = Number(value);
  return Number.isInteger(badgeId) && badgeId >= 0 ? badgeId : null;
};

const normalizeFrontendDefinition = (badgeDefinition) => {
  const onChainBadgeId = getOnChainBadgeId(
    badgeDefinition?.onChainBadgeId ?? badgeDefinition?.on_chain_badge_id,
  );
  if (onChainBadgeId == null) return null;

  const firstCriterion = Array.isArray(badgeDefinition?.criteria) ? badgeDefinition.criteria[0] : null;
  const ruleType = normalizeRuleType(
    RULE_TYPE_BY_CRITERION[String(firstCriterion?.type || '').trim().toLowerCase()],
  );

  return {
    badge_id: onChainBadgeId,
    name: String(badgeDefinition?.name || '').trim(),
    rule_type: ruleType,
    rule_params:
      firstCriterion?.params &&
      typeof firstCriterion.params === 'object' &&
      !Array.isArray(firstCriterion.params)
        ? firstCriterion.params
        : {},
    is_active: badgeDefinition?.enabled !== false,
  };
};

const normalizeBadgeConfig = (badgeConfig) => {
  const onChainBadgeId = getOnChainBadgeId(
    badgeConfig?.onChainBadgeId ?? badgeConfig?.badgeId,
  );
  if (onChainBadgeId == null) return null;

  return {
    badge_id: onChainBadgeId,
    name: String(badgeConfig?.badgeId || '').trim(),
    rule_type: normalizeRuleType(badgeConfig?.rule),
    rule_params:
      badgeConfig?.params &&
      typeof badgeConfig.params === 'object' &&
      !Array.isArray(badgeConfig.params)
        ? badgeConfig.params
        : {},
    is_active: true,
  };
};

// ---------------------------------------------------------------------------
// Public: resolveBadgeDefinition
// ---------------------------------------------------------------------------

/**
 * Load a badge definition for `badgeId` from (in priority order):
 *   1. Cached scanner configs (state files)
 *   2. Cached badge definitions (state files)
 *   3. Supabase `badge_definitions` table
 *
 * @param {{ supabase: object|null, badgeId: number|string }} opts
 * @returns {{ badgeDefinition: object|null, source: string, error?: string }}
 */
export const resolveBadgeDefinition = async ({ supabase, badgeId }) => {
  const [resolvedConfigs, resolvedDefinitions] = await Promise.all([
    loadResolvedBadgeConfigs().catch(() => ({ configs: [] })),
    loadResolvedBadgeDefinitions().catch(() => ({ badges: [] })),
  ]);

  const normalizedBadgeId = String(badgeId ?? '').trim();

  const configMatch = Array.isArray(resolvedConfigs.configs)
    ? resolvedConfigs.configs
        .map(normalizeBadgeConfig)
        .find((entry) => entry && String(entry.badge_id ?? '').trim() === normalizedBadgeId)
    : null;
  if (configMatch) return { badgeDefinition: configMatch, source: 'config' };

  const definitionMatch = Array.isArray(resolvedDefinitions.badges)
    ? resolvedDefinitions.badges
        .map(normalizeFrontendDefinition)
        .find((entry) => entry && String(entry.badge_id ?? '').trim() === normalizedBadgeId)
    : null;
  if (definitionMatch) return { badgeDefinition: definitionMatch, source: 'definitions' };

  if (!supabase) return { badgeDefinition: null, source: 'none' };

  const { data, error } = await supabase
    .from('badge_definitions')
    .select('badge_id, name, rule_type, rule_params, is_active')
    .eq('badge_id', normalizedBadgeId)
    .maybeSingle();

  if (error) {
    return {
      badgeDefinition: null,
      source: 'supabase',
      error: error.message || 'Failed to fetch badge definition',
    };
  }

  return { badgeDefinition: data || null, source: 'supabase', error: null };
};

// ---------------------------------------------------------------------------
// Public: viewBool
// ---------------------------------------------------------------------------

/**
 * Call a boolean on-chain view function.
 *
 * @param {{ client, fn: string, walletAddress: string, badgeId: number }} opts
 * @returns {{ ok: boolean, value: boolean, error?: string }}
 */
export const viewBool = async ({ client, fn, walletAddress, badgeId }) => {
  try {
    const result = await client.view({
      payload: {
        function: fn,
        typeArguments: [],
        functionArguments: [walletAddress, badgeId],
      },
    });
    return { ok: true, value: Boolean(result && result[0]) };
  } catch (error) {
    return {
      ok: false,
      value: false,
      error: String(error?.message || 'On-chain view failed').slice(0, 240),
    };
  }
};

// ---------------------------------------------------------------------------
// Public: evaluateRule
// ---------------------------------------------------------------------------

/**
 * Evaluate a badge's eligibility rule against a wallet address.
 *
 * NOTE: The ALLOWLIST rule type relied on an on-chain `is_allowlisted` view
 * function that was removed in the new off-chain signature architecture.
 * ALLOWLIST badges now require manual admin verification.
 *
 * @returns {{ eligible: boolean, reason: string, progress: object, requiresAdmin?: boolean }}
 */
export const evaluateRule = async ({
  walletAddress,
  badgeDefinition,
  client,
  moduleAddress,
  badgeId,
}) => {
  const ruleType = String(badgeDefinition?.rule_type || '').trim().toUpperCase();
  const params =
    badgeDefinition?.rule_params && typeof badgeDefinition.rule_params === 'object'
      ? badgeDefinition.rule_params
      : {};

  switch (ruleType) {
    case 'TRANSACTION_COUNT': {
      const txResult = await getTransactionCount(walletAddress);
      const required = getNumberParam(params, ['min_count', 'minCount', 'min'], 1);
      if (txResult.error) {
        return {
          eligible: false,
          reason: `Unable to check transaction count: ${txResult.error}`,
          progress: { current: 0, required },
        };
      }
      const eligible = txResult.count >= required;
      return {
        eligible,
        reason: eligible
          ? `Transaction count ${txResult.count}/${required}`
          : `Need ${required} transactions, found ${txResult.count}`,
        progress: { current: txResult.count, required },
      };
    }

    case 'DAYS_ONCHAIN': {
      const ageResult = await getDaysOnchain(walletAddress);
      const required = getNumberParam(params, ['min_days', 'minDays', 'min'], 1);
      if (ageResult.error) {
        return {
          eligible: false,
          reason: `Unable to check days on-chain: ${ageResult.error}`,
          progress: { current: 0, required },
        };
      }
      const eligible = ageResult.days >= required;
      return {
        eligible,
        reason: eligible
          ? `On-chain age ${ageResult.days}/${required} days`
          : `Need ${required} on-chain days, found ${ageResult.days}`,
        progress: { current: ageResult.days, required, firstTxAt: ageResult.firstTxAt || null },
      };
    }

    case 'MIN_BALANCE': {
      const coinType = getStringParam(params, ['coin_type', 'coinType']);
      const minAmount = getNumberParam(params, ['min_amount', 'minAmount', 'min'], 0);
      if (!coinType) {
        return {
          eligible: false,
          reason: 'MIN_BALANCE requires rule_params.coinType',
          progress: { current: 0, required: minAmount },
        };
      }
      const balanceResult = await getTokenBalance(walletAddress, coinType);
      if (balanceResult.error) {
        return {
          eligible: false,
          reason: `Unable to check token balance: ${balanceResult.error}`,
          progress: { current: 0, required: minAmount },
        };
      }
      const humanBalance =
        balanceResult.balance / Math.pow(10, Number(balanceResult.decimals || 0));
      const eligible = humanBalance >= minAmount;
      return {
        eligible,
        reason: eligible
          ? `Token balance ${humanBalance}/${minAmount}`
          : `Need token balance ${minAmount}, found ${humanBalance}`,
        progress: { current: humanBalance, required: minAmount, coinType, decimals: balanceResult.decimals },
      };
    }

    case 'PROTOCOL_COUNT': {
      const protocolResult = await getProtocolCount(walletAddress);
      const required = getNumberParam(params, ['min_protocols', 'minProtocols', 'min'], 1);
      if (protocolResult.error) {
        return {
          eligible: false,
          reason: `Unable to check protocol usage: ${protocolResult.error}`,
          progress: { current: 0, required },
        };
      }
      const eligible = protocolResult.count >= required;
      return {
        eligible,
        reason: eligible
          ? `Protocol usage ${protocolResult.count}/${required}`
          : `Need ${required} protocols, found ${protocolResult.count}`,
        progress: { current: protocolResult.count, required, protocols: protocolResult.protocols },
      };
    }

    case 'DAPP_USAGE': {
      const dappKey = getStringParam(params, ['dapp_key', 'dappKey', 'protocol', 'dapp']);
      const dappName = getStringParam(params, ['dapp_name', 'dappName', 'protocolName']);
      const dappContract = getStringParam(params, ['dapp_contract', 'dappContract', 'contract']);
      const usageResult = await getDappUsage(walletAddress, {
        dapp_key: dappKey,
        dapp_name: dappName,
        dapp_contract: dappContract,
      });

      if (usageResult.error) {
        return {
          eligible: false,
          reason: `Unable to check dApp usage: ${usageResult.error}`,
          progress: { current: 0, required: 1 },
        };
      }

      const eligible = usageResult.count > 0;
      return {
        eligible,
        reason: eligible
          ? `dApp usage confirmed (${usageResult.count} matching transaction${usageResult.count === 1 ? '' : 's'})`
          : 'Required dApp usage not found',
        progress: { current: usageResult.count, required: 1, dappKey, dappName, dappContract },
      };
    }

    case 'DEX_VOLUME': {
      const volumeResult = await getDexVolume(walletAddress);
      if (volumeResult.error) {
        return {
          eligible: false,
          reason: `Unable to check DEX volume: ${volumeResult.error}`,
          progress: { current: 0, required: Number(params.minVolume ?? params.minUsd ?? 0) },
        };
      }
      const required = Number(params.minVolume ?? params.minUsd ?? 0);
      const eligible = volumeResult.volumeUsd >= required;
      return {
        eligible,
        reason: eligible
          ? `DEX volume $${volumeResult.volumeUsd.toFixed(2)}/$${required}`
          : `Need DEX volume $${required}, found $${volumeResult.volumeUsd.toFixed(2)}`,
        progress: { current: volumeResult.volumeUsd, required },
      };
    }

    case 'ALLOWLIST':
      // The on-chain is_allowlisted view function was removed in the new
      // off-chain signature architecture.  ALLOWLIST badges require admin
      // verification to receive a mint signature directly.
      return {
        eligible: false,
        requiresAdmin: true,
        reason: 'ALLOWLIST badges require admin verification',
        progress: {},
      };

    default:
      return {
        eligible: false,
        requiresAdmin: true,
        reason: `Rule type ${ruleType || '(empty)'} requires admin verification`,
        progress: {},
      };
  }
};
