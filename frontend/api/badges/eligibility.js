import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { viewBool } from '../_lib/badgeEligibility.js';
import { invokeSupabaseFunction } from '../_lib/supabaseFunctions.js';
import { normalizeAddress64 } from '../_lib/address.js';

const METHODS = ['GET', 'OPTIONS'];
const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;
const WALLET_REGEX = /^0x[a-fA-F0-9]{1,64}$/;


const normalizeAddress = (value) => normalizeAddress64(value);

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

const createAptosClient = () => {
  const fullnode = getFullnodeUrl();
  return new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode }));
};

const parseBadgeId = (value) => {
  const badgeId = Number(value);
  if (!Number.isInteger(badgeId) || badgeId < 0) return null;
  return badgeId;
};


export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  try {
    const ip = getClientIp(req);
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
      key: `badges:eligibility:${ip}:${walletAddress}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });

    if (!limiter.ok) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
      return sendJson(res, 429, {
        status: 'rate_limited',
        reason: 'Max 30 eligibility checks per IP+wallet per hour',
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

    const verify = await invokeSupabaseFunction('verify-badge', {
      wallet_address: walletAddress,
      badge_id: String(badgeId),
    });

    if (!verify.ok) {
      console.error('[eligibility] verify-badge failed:', verify.status, verify.error);
      return sendJson(res, 503, { status: 'error', error: 'Could not verify badge eligibility' });
    }

    if (verify.data?.eligible === true) {
      return sendJson(res, 200, {
        status: 'eligible',
        cached: Boolean(verify.data?.cached),
        proofHash: verify.data?.proof_hash || null,
        reason: verify.data?.reason || 'eligible',
      });
    }

    const reason = String(verify.data?.reason || 'not-eligible');
    const requiresAdmin = reason.includes('manual-attestation') || reason.includes('requires-manual-attestation');

    return sendJson(res, 200, requiresAdmin
      ? { status: 'requires_admin', reason }
      : { status: 'not_eligible', reason, progress: {} }
    );
  } catch (error) {
    console.error('[badges/eligibility] request failed', error);
    return sendJson(res, 500, {
      status: 'error',
      error: String(error?.message || 'Internal server error').slice(0, 240),
    });
  }
}
