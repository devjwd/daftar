import { createClient } from '@supabase/supabase-js';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import {
  getTransactionCount,
  getDaysOnchain,
  getProtocolCount,
  getDexVolume,
  getTokenBalance,
} from '../services/movementIndexer.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { loadResolvedBadgeConfigs } from '../_lib/badgeConfigsState.js';
import { loadResolvedBadgeDefinitions } from '../_lib/badgeDefinitionsState.js';
import { handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { attestBadgeAllowlistOnChain } from '../_lib/onchainAttestation.js';
import { createAttestation } from '../services/attestationSigner.js';

const METHODS = ['GET', 'OPTIONS'];
const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;
const WALLET_REGEX = /^0x[a-fA-F0-9]{1,64}$/;
const NEGATIVE_CACHE_MINUTES = 30;
const POSITIVE_CACHE_MINUTES = 24 * 60;
const RULE_TYPE_BY_NUMBER = {
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
const RULE_TYPE_BY_CRITERION = {
  transaction_count: 'TRANSACTION_COUNT',
  days_onchain: 'DAYS_ONCHAIN',
  min_balance: 'MIN_BALANCE',
  protocol_count: 'PROTOCOL_COUNT',
  protocol_usage: 'DAPP_USAGE',
  dapp_usage: 'DAPP_USAGE',
  dex_volume: 'DEX_VOLUME',
  allowlist: 'ALLOWLIST',
};

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const getBadgeModuleAddress = () => {
  const raw = String(
    process.env.BADGE_MODULE_ADDRESS ||
      process.env.VITE_BADGE_SBT_MODULE_ADDRESS ||
      process.env.VITE_BADGE_MODULE_ADDRESS ||
      ''
  )
    .trim()
    .toLowerCase();

  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const getFullnodeUrl = () => {
  const explicit = String(process.env.MOVEMENT_RPC_URL || '').trim();
  if (explicit) return explicit;

  const network = String(process.env.VITE_NETWORK || 'mainnet').toLowerCase();
  return network === 'testnet'
    ? 'https://testnet.movementnetwork.xyz/v1'
    : 'https://mainnet.movementnetwork.xyz/v1';
};

const createAptosClient = () => {
  const fullnode = getFullnodeUrl();
  return new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode }));
};

const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

const parseBadgeId = (value) => {
  const badgeId = Number(value);
  if (!Number.isInteger(badgeId) || badgeId < 0) return null;
  return badgeId;
};

const getOnChainBadgeId = (value) => {
  const badgeId = Number(value);
  return Number.isInteger(badgeId) && badgeId >= 0 ? badgeId : null;
};

const normalizeRuleType = (value) => {
  if (typeof value === 'number') {
    return RULE_TYPE_BY_NUMBER[value] || '';
  }

  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return RULE_TYPE_BY_NUMBER[numeric] || '';
  }

  return String(value || '').trim().toUpperCase();
};

const normalizeFrontendDefinition = (badgeDefinition) => {
  const onChainBadgeId = getOnChainBadgeId(badgeDefinition?.onChainBadgeId ?? badgeDefinition?.on_chain_badge_id);
  if (onChainBadgeId == null) return null;

  const firstCriterion = Array.isArray(badgeDefinition?.criteria) ? badgeDefinition.criteria[0] : null;
  const ruleType = normalizeRuleType(RULE_TYPE_BY_CRITERION[String(firstCriterion?.type || '').trim().toLowerCase()]);

  return {
    badge_id: onChainBadgeId,
    name: String(badgeDefinition?.name || '').trim(),
    rule_type: ruleType,
    rule_params:
      firstCriterion?.params && typeof firstCriterion.params === 'object' && !Array.isArray(firstCriterion.params)
        ? firstCriterion.params
        : {},
    is_active: badgeDefinition?.enabled !== false,
  };
};

const normalizeBadgeConfig = (badgeConfig) => {
  const onChainBadgeId = getOnChainBadgeId(badgeConfig?.onChainBadgeId ?? badgeConfig?.badgeId);
  if (onChainBadgeId == null) return null;

  return {
    badge_id: onChainBadgeId,
    name: String(badgeConfig?.badgeId || '').trim(),
    rule_type: normalizeRuleType(badgeConfig?.rule),
    rule_params:
      badgeConfig?.params && typeof badgeConfig.params === 'object' && !Array.isArray(badgeConfig.params)
        ? badgeConfig.params
        : {},
    is_active: true,
  };
};

const resolveBadgeDefinition = async ({ supabase, badgeId }) => {
  const [resolvedConfigs, resolvedDefinitions] = await Promise.all([
    loadResolvedBadgeConfigs().catch(() => ({ configs: [] })),
    loadResolvedBadgeDefinitions().catch(() => ({ badges: [] })),
  ]);

  const configMatch = Array.isArray(resolvedConfigs.configs)
    ? resolvedConfigs.configs
        .map(normalizeBadgeConfig)
        .find((entry) => entry && entry.badge_id === badgeId)
    : null;
  if (configMatch) {
    return { badgeDefinition: configMatch, source: 'config' };
  }

  const definitionMatch = Array.isArray(resolvedDefinitions.badges)
    ? resolvedDefinitions.badges
        .map(normalizeFrontendDefinition)
        .find((entry) => entry && entry.badge_id === badgeId)
    : null;
  if (definitionMatch) {
    return { badgeDefinition: definitionMatch, source: 'definitions' };
  }

  if (!supabase) {
    return { badgeDefinition: null, source: 'none' };
  }

  const { data, error } = await supabase
    .from('badge_definitions')
    .select('badge_id, name, rule_type, rule_params, is_active')
    .eq('badge_id', badgeId)
    .maybeSingle();

  if (error) {
    return { badgeDefinition: null, source: 'supabase', error: error.message || 'Failed to fetch badge definition' };
  }

  return { badgeDefinition: data || null, source: 'supabase', error: null };
};

const isStillValidAttestation = (record) => {
  if (!record) return false;
  if (!record.eligible) return false;
  if (!record.expires_at) return true;
  return new Date(record.expires_at).getTime() > Date.now();
};

const hasFreshNegativeResult = (record) => {
  if (!record || record.eligible !== false) return false;
  if (record.expires_at) {
    return new Date(record.expires_at).getTime() > Date.now();
  }

  const verifiedAtMs = new Date(record.verified_at || 0).getTime();
  if (!Number.isFinite(verifiedAtMs) || verifiedAtMs <= 0) return false;
  return Date.now() - verifiedAtMs < NEGATIVE_CACHE_MINUTES * 60_000;
};

const getCachedAttestation = async (supabase, walletAddress, badgeId) => {
  try {
    const { data, error } = await supabase
      .from('badge_attestations')
      .select('wallet_address, badge_id, eligible, verified_at, expires_at, proof_hash')
      .eq('wallet_address', walletAddress)
      .eq('badge_id', badgeId)
      .maybeSingle();

    if (error) {
      return { record: null, error: error.message || 'Failed to read attestation cache' };
    }

    return { record: data || null, error: null };
  } catch (error) {
    console.error('[eligibility] getCachedAttestation failed:', error.message);
    return null;
  }
};

const saveAttestationToSupabase = async ({ supabase, walletAddress, badgeId, eligible, expiresAt, proofHash }) => {
  try {
    const payload = {
      wallet_address: walletAddress,
      badge_id: badgeId,
      eligible: Boolean(eligible),
      verified_at: new Date().toISOString(),
      expires_at: expiresAt || null,
      proof_hash: proofHash || null,
    };

    const result = await supabase.from('badge_attestations').upsert(payload, {
      onConflict: 'wallet_address,badge_id',
    });

    if (result.error) {
      return { ok: false, error: result.error.message || 'Failed to persist attestation cache' };
    }

    return { ok: true, error: null };
  } catch (error) {
    console.error('[eligibility] saveAttestationToSupabase failed:', error.message);
    return false;
  }
};

const viewBool = async ({ client, fn, walletAddress, badgeId }) => {
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

const evaluateRule = async ({ walletAddress, badgeDefinition, client, moduleAddress, badgeId }) => {
  const ruleType = String(badgeDefinition?.rule_type || '').trim().toUpperCase();
  const params =
    badgeDefinition?.rule_params && typeof badgeDefinition.rule_params === 'object'
      ? badgeDefinition.rule_params
      : {};

  switch (ruleType) {
    case 'TRANSACTION_COUNT': {
      const txResult = await getTransactionCount(walletAddress);
      if (txResult.error) {
        return {
          eligible: false,
          reason: `Unable to check transaction count: ${txResult.error}`,
          progress: { current: 0, required: Number(params.minCount ?? params.min ?? 1) },
        };
      }

      const required = Number(params.minCount ?? params.min ?? 1);
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
      if (ageResult.error) {
        return {
          eligible: false,
          reason: `Unable to check days on-chain: ${ageResult.error}`,
          progress: { current: 0, required: Number(params.minDays ?? params.min ?? 1) },
        };
      }

      const required = Number(params.minDays ?? params.min ?? 1);
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
      const coinType = String(params.coinType || '').trim();
      const minAmount = Number(params.minAmount ?? params.min ?? 0);
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

      const humanBalance = balanceResult.balance / Math.pow(10, Number(balanceResult.decimals || 0));
      const eligible = humanBalance >= minAmount;
      return {
        eligible,
        reason: eligible
          ? `Token balance ${humanBalance}/${minAmount}`
          : `Need token balance ${minAmount}, found ${humanBalance}`,
        progress: {
          current: humanBalance,
          required: minAmount,
          coinType,
          decimals: balanceResult.decimals,
        },
      };
    }

    case 'PROTOCOL_COUNT': {
      const protocolResult = await getProtocolCount(walletAddress);
      if (protocolResult.error) {
        return {
          eligible: false,
          reason: `Unable to check protocol usage: ${protocolResult.error}`,
          progress: { current: 0, required: Number(params.minProtocols ?? params.min ?? 1) },
        };
      }

      const required = Number(params.minProtocols ?? params.min ?? 1);
      const eligible = protocolResult.count >= required;
      return {
        eligible,
        reason: eligible
          ? `Protocol usage ${protocolResult.count}/${required}`
          : `Need ${required} protocols, found ${protocolResult.count}`,
        progress: {
          current: protocolResult.count,
          required,
          protocols: protocolResult.protocols,
        },
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
        progress: {
          current: volumeResult.volumeUsd,
          required,
        },
      };
    }

    case 'ALLOWLIST': {
      const allowlistCheck = await viewBool({
        client,
        fn: `${moduleAddress}::badges::is_allowlisted`,
        walletAddress,
        badgeId,
      });

      if (!allowlistCheck.ok) {
        return {
          eligible: false,
          reason: `Unable to check allowlist status: ${allowlistCheck.error}`,
          progress: { current: 0, required: 1 },
        };
      }

      const eligible = allowlistCheck.value;
      return {
        eligible,
        reason: eligible ? 'Wallet is already allowlisted' : 'Wallet is not in allowlist yet',
        progress: { current: eligible ? 1 : 0, required: 1 },
      };
    }

    default:
      return {
        eligible: false,
        requiresAdmin: true,
        reason: `Rule type ${ruleType || '(empty)'} requires admin verification`,
        progress: {},
      };
  }
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  try {
    const walletAddress = normalizeAddress(req.query?.wallet);
    const badgeId = parseBadgeId(req.query?.badgeId);

    if (!WALLET_REGEX.test(walletAddress)) {
      return sendJson(res, 400, { error: 'Invalid wallet address' });
    }

    if (badgeId == null) {
      return sendJson(res, 400, {
        error: 'Invalid wallet or badgeId',
        status: 'invalid_request',
      });
    }

    const limiter = enforceRateLimit({
      key: `badges:eligibility:${walletAddress}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });

    if (!limiter.ok) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
      return sendJson(res, 429, {
        status: 'rate_limited',
        reason: 'Max 5 eligibility checks per wallet per hour',
      });
    }

    const moduleAddress = getBadgeModuleAddress();
    if (!moduleAddress || !ADDRESS_RE.test(moduleAddress)) {
      return sendJson(res, 500, {
        status: 'error',
        error: 'BADGE_MODULE_ADDRESS is missing or invalid',
      });
    }

    const client = createAptosClient();

    const alreadyOwned = await viewBool({
      client,
      fn: `${moduleAddress}::badges::has_badge`,
      walletAddress,
      badgeId,
    });

    if (!alreadyOwned.ok) {
      return sendJson(res, 500, {
        status: 'error',
        error: `On-chain badge ownership check failed: ${alreadyOwned.error}`,
      });
    }

    if (alreadyOwned.value) {
      return sendJson(res, 200, {
        status: 'already_owned',
      });
    }

    let supabase = null;
    try {
      supabase = createSupabaseAdmin();
    } catch (error) {
      console.warn('[eligibility] Supabase unavailable, continuing without cache:', error.message);
    }

    if (supabase) {
      const cachedResult = await getCachedAttestation(supabase, walletAddress, badgeId);
      if (cachedResult === null) {
        return sendJson(res, 500, { status: 'error', error: 'Failed to read attestation cache' });
      }

      if (cachedResult.error) {
        return sendJson(res, 500, { status: 'error', error: cachedResult.error });
      }

      if (isStillValidAttestation(cachedResult.record)) {
        return sendJson(res, 200, {
          status: 'eligible',
          cached: true,
          proofHash: cachedResult.record.proof_hash || null,
          expiresAt: cachedResult.record.expires_at || null,
        });
      }

      if (hasFreshNegativeResult(cachedResult.record)) {
        return sendJson(res, 200, {
          status: 'not_eligible',
          cached: true,
          reason: 'Recent eligibility check indicates requirements are not met yet',
          progress: {},
        });
      }
    }

    const resolvedBadge = await resolveBadgeDefinition({ supabase, badgeId });
    if (resolvedBadge.error) {
      return sendJson(res, 500, {
        status: 'error',
        error: resolvedBadge.error,
      });
    }

    const badgeDefinition = resolvedBadge.badgeDefinition;
    if (!badgeDefinition || badgeDefinition.is_active === false) {
      return sendJson(res, 400, {
        status: 'invalid_request',
        error: 'Badge definition not found or inactive',
      });
    }

    const evaluation = await evaluateRule({
      walletAddress,
      badgeDefinition,
      client,
      moduleAddress,
      badgeId,
    });

    if (evaluation.requiresAdmin) {
      return sendJson(res, 200, {
        status: 'requires_admin',
        reason: evaluation.reason,
      });
    }

    if (!evaluation.eligible) {
      if (supabase) {
        const negativeExpiresAt = new Date(Date.now() + NEGATIVE_CACHE_MINUTES * 60_000).toISOString();
        const persistNegative = await saveAttestationToSupabase({
          supabase,
          walletAddress,
          badgeId,
          eligible: false,
          expiresAt: negativeExpiresAt,
          proofHash: null,
        });

        if (persistNegative === false) {
          return sendJson(res, 500, {
            status: 'error',
            error: 'Failed to persist attestation cache',
          });
        }

        if (!persistNegative.ok) {
          return sendJson(res, 500, {
            status: 'error',
            error: persistNegative.error,
          });
        }
      }

      return sendJson(res, 200, {
        status: 'not_eligible',
        reason: evaluation.reason,
        progress: evaluation.progress || {},
      });
    }

    const attestationResult = createAttestation({ walletAddress, badgeId, ttlMinutes: POSITIVE_CACHE_MINUTES });
    if (!attestationResult.ok) {
      return sendJson(res, 500, {
        status: 'error',
        error: `Attestation creation failed: ${attestationResult.error}`,
      });
    }

    const proof = attestationResult.attestation;
    if (supabase) {
      const persistPositive = await saveAttestationToSupabase({
        supabase,
        walletAddress,
        badgeId,
        eligible: true,
        expiresAt: proof.expiresAt,
        proofHash: proof.proofHash,
      });

      if (!persistPositive.ok) {
        return sendJson(res, 500, {
          status: 'error',
          error: persistPositive.error,
        });
      }
    }

    const allowlistTx = await attestBadgeAllowlistOnChain({
      ownerAddress: walletAddress,
      onChainBadgeId: badgeId,
    });

    if (!allowlistTx.ok) {
      return sendJson(res, 500, {
        status: 'error',
        error: allowlistTx.reason || 'Failed to add wallet to on-chain allowlist',
      });
    }

    return sendJson(res, 200, {
      status: 'eligible',
      cached: false,
      proof,
      allowlist: {
        alreadyAllowlisted: Boolean(allowlistTx.alreadyAllowlisted),
        txHash: allowlistTx.txHash || null,
      },
    });
  } catch (error) {
    console.error('[badges/eligibility] request failed', error);
    return sendJson(res, 500, {
      status: 'error',
      error: String(error?.message || 'Internal server error').slice(0, 240),
    });
  }
}
