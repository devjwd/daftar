/**
 * POST /api/badges/sign
 *
 * Returns an Ed25519 signature authorising the caller to mint a specific
 * badge on-chain.  The contract's `badges::mint` entry function verifies this
 * signature against the `signer_pub_key` stored in `BadgeRegistry`.
 *
 * Flow:
 *   1. Validate + rate-limit (per IP and per wallet)
 *   2. Confirm the wallet has not already minted this badge on-chain
 *   3. Load the badge definition and evaluate eligibility rules
 *   4. Sign only if eligible — return 403 otherwise
 *
 * Request body: { walletAddress: string, badgeId: number }
 * Response 200: { signatureBytes: number[] }   // 64-element array
 */

import { createClient } from '@supabase/supabase-js';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { enforceRateLimitDistributed } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { signMintPayload } from '../_lib/mintSigner.js';
import { viewBool } from '../_lib/badgeEligibility.js';
import { invokeSupabaseFunction } from '../_lib/supabaseFunctions.js';
import { normalizeAddress64 } from '../_lib/address.js';

const METHODS = ['POST', 'OPTIONS'];
const ADDRESS_RE = /^0x[a-fA-F0-9]{1,64}$/;

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

const createAptosClient = () =>
  new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: getFullnodeUrl() }));

const fetchSignerEpoch = async ({ client, moduleAddress }) => {
  const result = await client.view({
    payload: {
      function: `${moduleAddress}::badges::get_signer_epoch`,
      typeArguments: [],
      functionArguments: [],
    },
  });

  const raw = Array.isArray(result) ? result[0] : result;
  const epoch = Number(raw);
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error('Invalid signer epoch response');
  }
  return epoch;
};

const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') return methodNotAllowed(res, req.method, METHODS);

  const ip = getClientIp(req);
  const { walletAddress, badgeId } = req.body || {};

  const normalizedAddress = normalizeAddress(walletAddress);
  if (!ADDRESS_RE.test(normalizedAddress)) {
    return sendJson(res, 400, { error: 'Invalid wallet address' });
  }

  const numericBadgeId = Number(badgeId);
  if (!Number.isInteger(numericBadgeId) || numericBadgeId <= 0) {
    return sendJson(res, 400, { error: 'Invalid badge ID' });
  }

  // Rate-limit by both IP and wallet to prevent enumeration across addresses
  const limiter = await enforceRateLimitDistributed({
    key: `badges:sign:${ip}:${normalizedAddress}`,
    limit: Number(process.env.BADGES_SIGN_RATE_LIMIT || 20),
    windowMs: Number(process.env.BADGES_SIGN_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const moduleAddress = getBadgeModuleAddress();
  if (!moduleAddress || !ADDRESS_RE.test(moduleAddress)) {
    return sendJson(res, 503, { error: 'Badge module address not configured' });
  }

  const client = createAptosClient();

  // 1. Check the wallet has not already minted this badge on-chain
  const alreadyOwned = await viewBool({
    client,
    fn: `${moduleAddress}::badges::has_badge`,
    walletAddress: normalizedAddress,
    badgeId: numericBadgeId,
  });

  if (!alreadyOwned.ok) {
    console.error('[sign] on-chain ownership check failed:', alreadyOwned.error);
    return sendJson(res, 503, { error: 'Could not verify badge ownership' });
  }

  if (alreadyOwned.value) {
    return sendJson(res, 409, { error: 'Badge already minted by this wallet' });
  }

  // 2. Load the badge definition
  // 2. Verify eligibility via Supabase Edge Function (single source of truth)
  const verify = await invokeSupabaseFunction('verify-badge', {
    wallet_address: normalizedAddress,
    badge_id: String(numericBadgeId),
  });

  if (!verify.ok) {
    console.error('[sign] verify-badge failed:', verify.status, verify.error);
    return sendJson(res, 503, { error: 'Could not verify badge eligibility' });
  }

  if (!verify.data || verify.data.eligible !== true) {
    return sendJson(res, 403, {
      error: 'Eligibility requirements not met',
      reason: String(verify.data?.reason || 'not-eligible'),
    });
  }

  // 4. Sign the mint payload
  const validUntil = Math.floor(Date.now() / 1000) + 300; // 5-minute expiry window
  let signatureBytes;
  try {
    const signerEpoch = await fetchSignerEpoch({ client, moduleAddress });
    signatureBytes = signMintPayload(
      normalizedAddress,
      numericBadgeId,
      validUntil,
      moduleAddress,
      signerEpoch,
    );
  } catch (error) {
    console.error('[sign] signMintPayload failed:', error.message);
    return sendJson(res, 503, { error: 'Signing service unavailable' });
  }

  return sendJson(res, 200, { signatureBytes, validUntil });
}
