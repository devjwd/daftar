/**
 * GET /api/badges
 * Returns the list of badge configurations.
 */
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { loadResolvedBadgeConfigs } from '../_lib/badgeConfigsState.js';

const METHODS = ['GET', 'OPTIONS'];

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `badges:index:read:${ip}`,
    limit: Number(process.env.BADGES_READ_RATE_LIMIT || 180),
    windowMs: Number(process.env.BADGES_READ_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  const { configs } = await loadResolvedBadgeConfigs();
  return sendJson(res, 200, configs);
}
