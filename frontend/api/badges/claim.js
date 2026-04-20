/**
 * POST /api/badges/claim
 * Optimized for production scaling.
 * Direct database writes; legacy loadState/saveState removed for performance.
 */
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { checkAdmin } from '../_lib/auth.js';
import { enforceRateLimitDistributed } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { getSupabaseAdmin } from './supabase.js';
import { normalizeAddress64 } from '../_lib/address.js';

const METHODS = ['POST', 'OPTIONS'];
const WALLET_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

const normalizeAddress = (address) => normalizeAddress64(address);

const getBadgeModuleAddress = () => {
  const raw = String(process.env.BADGE_MODULE_ADDRESS || '').trim().toLowerCase();
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
  const limiter = await enforceRateLimitDistributed({
    key: `badges:claim:write:${ip}`,
    limit: Number(process.env.BADGES_WRITE_RATE_LIMIT || 40),
    windowMs: Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  // Admin authentication (requires wallet signature or service key)
  const auth = checkAdmin(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const { address, badgeId, payload } = req.body || {};
  const normalizedAddress = normalizeAddress(address);
  if (!WALLET_REGEX.test(normalizedAddress)) {
    return sendJson(res, 400, { error: 'Invalid wallet address' });
  }

  if (!badgeId || !payload?.onChainBadgeId) {
    return sendJson(res, 400, { error: 'address, badgeId, and onChainBadgeId are required' });
  }

  const numericOnChainBadgeId = Number(payload.onChainBadgeId);
  if (!Number.isFinite(numericOnChainBadgeId) || numericOnChainBadgeId < 0) {
    return sendJson(res, 400, { error: 'invalid onChainBadgeId' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return sendJson(res, 500, { error: 'Database connection failed' });
  }

  // 1. Verify Ownership On-Chain
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

  try {
    const verifiedAt = new Date().toISOString();
    
    // 2. ATOMIC DB WRITE 
    // This triggers sync_user_xp in Postgres, handling Profiles and XP automatically.
    const { error: attestationError } = await supabase
      .from('badge_attestations')
      .upsert(
        {
          wallet_address: normalizedAddress,
          badge_id: String(badgeId),
          eligible: true,
          verified_at: verifiedAt,
          proof_hash: payload.proofHash || `claim:${normalizedAddress}:${badgeId}:${Date.now()}`,
        },
        { onConflict: 'wallet_address,badge_id' }
      );

    if (attestationError) {
      console.error('[claim] DB Error:', attestationError);
      return sendJson(res, 500, { error: 'Failed to persist badge attestation' });
    }

    // 3. Mark as tracked
    await supabase.from('badge_tracked_addresses').upsert({
      wallet_address: normalizedAddress,
      added_at: verifiedAt,
    }, { onConflict: 'wallet_address' });

    return sendJson(res, 200, {
      success: true,
      walletAddress: normalizedAddress,
      badgeId,
      verifiedAt
    });

  } catch (error) {
    console.error('[badges/claim] request failed', error);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
}
