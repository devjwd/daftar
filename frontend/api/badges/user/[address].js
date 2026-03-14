/**
 * GET /api/badges/user/[address]
 * Returns the list of badge awards for a given wallet address.
 */
import { loadState } from '../../_lib/state.js';
import { enforceRateLimit } from '../../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../../_lib/http.js';

const normalizeAddress = (address) => {
  const n = String(address || '').trim().toLowerCase();
  return n.startsWith('0x') ? n : `0x${n}`;
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

  const { userAwards } = await loadState();
  const addr = normalizeAddress(address);
  return sendJson(res, 200, userAwards[addr] || []);
}
