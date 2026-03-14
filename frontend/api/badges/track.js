/**
 * POST /api/badges/track
 * Adds a wallet address to the tracked list so the scanner evaluates it.
 *
 * Body: { address: string }
 * Header: x-admin-key: <BADGE_ADMIN_API_KEY>
 */
import { loadState, saveState } from '../_lib/state.js';
import { checkAdmin } from '../_lib/auth.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';

const normalizeAddress = (address) => {
  const n = String(address || '').trim().toLowerCase();
  return n.startsWith('0x') ? n : `0x${n}`;
};

const isLikelyAddress = (address) =>
  /^0x[a-f0-9]{1,128}$/i.test(String(address || '').trim());

const METHODS = ['POST', 'OPTIONS'];

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `badges:track:write:${ip}`,
    limit: Number(process.env.BADGES_WRITE_RATE_LIMIT || 40),
    windowMs: Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const auth = checkAdmin(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const { address } = req.body || {};
  if (!address || !isLikelyAddress(address)) {
    return sendJson(res, 400, { error: 'valid address required' });
  }

  const { userAwards, trackedAddresses } = await loadState();
  const addr = normalizeAddress(address);

  if (!trackedAddresses.includes(addr)) trackedAddresses.push(addr);

  await saveState(userAwards, trackedAddresses);
  return sendJson(res, 200, { tracked: trackedAddresses });
}
