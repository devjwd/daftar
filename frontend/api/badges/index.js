/**
 * GET/POST /api/badges
 * GET: returns full badge definitions for the public UI.
 * POST: replaces full badge definitions in Blob state (admin only).
 */
import { checkAdmin } from '../_lib/auth.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import {
  loadResolvedBadgeDefinitions,
  saveBadgeDefinitions,
  validateBadgeDefinitionsPayload,
} from '../_lib/badgeDefinitionsState.js';
import { loadState, saveState } from '../_lib/state.js';

const METHODS = ['GET', 'POST', 'OPTIONS'];

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET' && req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `badges:index:${req.method.toLowerCase()}:${ip}`,
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
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    const { badges, source } = await loadResolvedBadgeDefinitions();
    return sendJson(res, 200, { badges, source });
  }

  const auth = checkAdmin(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const rawDefinitions = Array.isArray(req.body) ? req.body : req.body?.badges;
  const clearAwards = Boolean(req.body?.clearAwards);
  const validated = validateBadgeDefinitionsPayload(rawDefinitions);
  if (!validated.ok) {
    return sendJson(res, 400, { error: validated.error });
  }

  const badgeDefinitions = validated.normalized;

  if (clearAwards) {
    const { badgeConfigs } = await loadState();
    await saveState({}, [], badgeConfigs, badgeDefinitions);
  } else {
    await saveBadgeDefinitions(badgeDefinitions);
  }

  return sendJson(res, 200, {
    status: 'ok',
    count: badgeDefinitions.length,
    badges: badgeDefinitions,
    clearedAwards: clearAwards,
  });
}
