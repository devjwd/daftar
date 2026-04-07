/**
 * GET /api/badges/user/[address]
 * Returns the list of badge awards for a given wallet address.
 */
import { enforceRateLimit } from '../../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../../_lib/http.js';
import { loadState } from '../../_lib/state.js';
import { getSupabaseAdmin } from '../supabase.js';

const WALLET_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

const normalizeAddress = (address) => {
  const n = String(address || '').trim().toLowerCase();
  return n.startsWith('0x') ? n : `0x${n}`;
};

const mapAttestationToAward = (row) => ({
  badgeId: String(row?.badge_id || ''),
  awardedAt: row?.verified_at || null,
  payload: {
    eligible: row?.eligible === true,
    proofHash: row?.proof_hash || null,
  },
});

const getBlobAwards = async (address) => {
  try {
    const { userAwards } = await loadState();
    const legacyAddr = address.startsWith('0x') ? address.slice(2) : address;
    return userAwards[address] || userAwards[legacyAddr] || [];
  } catch (error) {
    console.error('[user awards] getBlobAwards failed:', error.message);
    return [];
  }
};

const METHODS = ['GET', 'OPTIONS'];

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `badges:user:read:${ip}`,
    limit: Number(process.env.BADGES_READ_RATE_LIMIT || 180),
    windowMs: Number(process.env.BADGES_READ_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const { address } = req.query;
  if (!address) return sendJson(res, 400, { error: 'address required' });

  const addr = normalizeAddress(address);
  if (!WALLET_REGEX.test(addr)) {
    return sendJson(res, 400, { error: 'Invalid wallet address' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    console.error('[user awards] Supabase client init failed:', error);
    const blobAwards = await getBlobAwards(addr);
    return sendJson(res, 200, blobAwards);
  }

  const { data, error } = await supabase
    .from('badge_attestations')
    .select('badge_id, eligible, verified_at, proof_hash')
    .eq('wallet_address', addr)
    .eq('eligible', true);

  if (error) {
    console.error('[user awards] Supabase query failed:', error);
    const blobAwards = await getBlobAwards(addr);
    return sendJson(res, 200, blobAwards);
  }

  if (Array.isArray(data) && data.length > 0) {
    return sendJson(res, 200, data.map(mapAttestationToAward));
  }

  const blobAwards = await getBlobAwards(addr);
  if (Array.isArray(blobAwards) && blobAwards.length > 0) {
    console.warn('[user awards] Supabase empty, falling back to Blob for:', address);
    return sendJson(res, 200, blobAwards);
  }

  return sendJson(res, 200, []);
}
