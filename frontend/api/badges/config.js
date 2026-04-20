/**
 * GET/POST /api/badges/config
 * GET: Returns scanner badge configs.
 * POST: Publishes scanner badge configs (admin only).
 */
import { checkAdmin } from '../_lib/auth.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import {
  loadResolvedBadgeConfigs,
  saveBadgeConfigs,
  validateBadgeConfigsPayload,
} from '../_lib/badgeConfigsState.js';

const METHODS = ['GET', 'POST', 'OPTIONS'];

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET' && req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `badges:config:${req.method.toLowerCase()}:${ip}`,
    limit:
      req.method === 'GET'
        ? Number(process.env.BADGES_READ_RATE_LIMIT || 180)
        : Number(process.env.BADGES_WRITE_RATE_LIMIT || 40),
    windowMs:
      req.method === 'GET'
        ? Number(process.env.BADGES_READ_RATE_WINDOW_MS || 60_000)
        : Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  if (req.method === 'GET') {
    const { configs, source } = await loadResolvedBadgeConfigs();
    return sendJson(res, 200, { badgeConfigs: configs, source });
  }

  const auth = checkAdmin(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const rawConfigs = Array.isArray(req.body) ? req.body : req.body?.badgeConfigs;
  const validated = validateBadgeConfigsPayload(rawConfigs);
  if (!validated.ok) {
    return sendJson(res, 400, { error: validated.error });
  }

  const saved = await saveBadgeConfigs(validated.normalized);
  return sendJson(res, 200, {
    status: 'ok',
    count: saved.length,
    badgeConfigs: saved,
  });
}
