/**
 * POST /api/badges/claim
 * Legacy admin route kept only for compatibility.
 * Shared-key auth is disabled; use the Supabase wallet-signed admin flow instead.
 */
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { checkAdmin } from '../_lib/auth.js';
import { loadState, saveState } from '../_lib/state.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { getSupabaseAdmin } from './supabase.js';

const METHODS = ['POST', 'OPTIONS'];
const WALLET_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

const normalizeAddress = (address) => {
  const n = String(address || '').trim().toLowerCase();
  return n.startsWith('0x') ? n : `0x${n}`;
};

const getBadgeModuleAddress = () => {
  const raw = String(
    process.env.BADGE_MODULE_ADDRESS ||
    process.env.VITE_BADGE_SBT_MODULE_ADDRESS ||
    process.env.VITE_BADGE_MODULE_ADDRESS ||
    ''
  ).trim().toLowerCase();
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

const createAptosClient = () => new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: getFullnodeUrl() }));

const loadBadgeDefinition = async (supabase, badgeId) => {
  try {
    const result = await supabase
      .from('badge_definitions')
      .select('*')
      .eq('badge_id', String(badgeId))
      .maybeSingle();

    if (result.error) {
      return {
        ok: false,
        error: result.error.message || 'Failed to fetch badge definition',
        badgeDefinition: null,
      };
    }

    return {
      ok: true,
      error: null,
      badgeDefinition: result.data || null,
    };
  } catch (error) {
    console.error('[claim] loadBadgeDefinition failed:', error.message);
    return null;
  }
};

const getBadgeDefinitionOnChainBadgeId = (badgeDefinition) => {
  const value = badgeDefinition?.onChainBadgeId ?? badgeDefinition?.on_chain_badge_id;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const verifyOwnership = async ({ ownerAddress, onChainBadgeId }) => {
  const moduleAddress = getBadgeModuleAddress();
  if (!moduleAddress || !WALLET_REGEX.test(moduleAddress)) {
    return { ok: false, reason: 'BADGE_MODULE_ADDRESS is missing or invalid' };
  }

  const numericBadgeId = Number(onChainBadgeId);
  if (!Number.isFinite(numericBadgeId) || numericBadgeId < 0) {
    return { ok: false, reason: 'Invalid on-chain badge id' };
  }

  try {
    const client = createAptosClient();
    const result = await client.view({
      payload: {
        function: `${moduleAddress}::badges::has_badge`,
        typeArguments: [],
        functionArguments: [ownerAddress, numericBadgeId],
      },
    });

    return { ok: Boolean(result && result[0]) };
  } catch (error) {
    return { ok: false, reason: String(error?.message || 'Ownership check failed').slice(0, 240) };
  }
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `badges:claim:write:${ip}`,
    limit: Number(process.env.BADGES_WRITE_RATE_LIMIT || 40),
    windowMs: Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const auth = checkAdmin(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const { address, badgeId, payload } = req.body || {};
  const normalizedAddress = normalizeAddress(address);
  if (!WALLET_REGEX.test(normalizedAddress)) {
    return sendJson(res, 400, { error: 'Invalid wallet address' });
  }

  if (!badgeId) {
    return sendJson(res, 400, { error: 'address and badgeId required' });
  }

  const onChainBadgeId = payload?.onChainBadgeId;
  if (onChainBadgeId == null || onChainBadgeId === '') {
    return sendJson(res, 400, { error: 'onChainBadgeId required to persist a claimed badge' });
  }

  const numericOnChainBadgeId = Number(onChainBadgeId);
  if (!Number.isFinite(numericOnChainBadgeId) || numericOnChainBadgeId < 0) {
    return sendJson(res, 400, { error: 'onChainBadgeId required to persist a claimed badge' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return sendJson(res, 500, {
      error: String(error?.message || 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY').slice(0, 240),
    });
  }

  const badgeDefinitionResult = await loadBadgeDefinition(supabase, badgeId);
  if (badgeDefinitionResult === null) {
    return sendJson(res, 500, { error: 'Failed to fetch badge definition' });
  }

  if (!badgeDefinitionResult.ok) {
    return sendJson(res, 500, { error: badgeDefinitionResult.error });
  }

  const expectedOnChainBadgeId = getBadgeDefinitionOnChainBadgeId(badgeDefinitionResult.badgeDefinition);
  if (expectedOnChainBadgeId !== numericOnChainBadgeId) {
    return sendJson(res, 403, {
      error: 'Badge ID mismatch — on-chain badge does not match the requested app badge',
    });
  }

  const ownership = await verifyOwnership({
    ownerAddress: normalizedAddress,
    onChainBadgeId: numericOnChainBadgeId,
  });
  if (!ownership.ok) {
    return sendJson(res, 409, {
      error: 'Badge ownership could not be verified',
      reason: ownership.reason || 'Address does not own badge on-chain yet',
    });
  }

  const { userAwards, trackedAddresses } = await loadState();
  const list = userAwards[normalizedAddress] || [];
  const existing = list.find((entry) => String(entry?.badgeId) === String(badgeId));
  if (existing) {
    return sendJson(res, 200, existing);
  }

  const record = {
    badgeId: String(badgeId),
    payload: {
      ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
      onChainBadgeId: numericOnChainBadgeId,
    },
    awardedAt: new Date().toISOString(),
  };

  list.push(record);
  userAwards[normalizedAddress] = list;
  if (!trackedAddresses.includes(normalizedAddress)) trackedAddresses.push(normalizedAddress);

  await saveState(userAwards, trackedAddresses);

  // MIGRATION: writing to Supabase in parallel with Blob
  try {
    const verifiedAt = new Date().toISOString();
    const proofHash =
      badgeDefinitionResult.badgeDefinition?.proof_hash ??
      badgeDefinitionResult.badgeDefinition?.proofHash ??
      `claim:${normalizedAddress}:${String(badgeId)}:${verifiedAt}`;

    const { error: attestationError } = await supabase
      .from('badge_attestations')
      .upsert(
        {
          wallet_address: normalizedAddress,
          badge_id: String(badgeId),
          eligible: true,
          verified_at: verifiedAt,
          proof_hash: proofHash,
        },
        { onConflict: 'wallet_address,badge_id' }
      );

    if (attestationError) {
      console.error('[badges/claim] badge_attestations upsert failed', {
        wallet_address: normalizedAddress,
        badge_id: String(badgeId),
        error: attestationError,
      });
    }

    const { error: trackedError } = await supabase
      .from('badge_tracked_addresses')
      .upsert(
        {
          wallet_address: normalizedAddress,
          added_at: verifiedAt,
        },
        { onConflict: 'wallet_address' }
      );

    if (trackedError) {
      console.error('[badges/claim] badge_tracked_addresses upsert failed', {
        wallet_address: normalizedAddress,
        badge_id: String(badgeId),
        error: trackedError,
      });
    }
  } catch (error) {
    console.error('[badges/claim] Supabase migration write failed', {
      wallet_address: normalizedAddress,
      badge_id: String(badgeId),
      error,
    });
  }

  return sendJson(res, 200, record);
}
