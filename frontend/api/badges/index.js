/**
 * GET/POST /api/badges
 * GET: returns full badge definitions for the public UI.
 * POST: replaces full badge definitions in Blob state (admin only).
 */
import { checkAdmin } from '../_lib/auth.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { loadState, saveState } from '../_lib/state.js';

const METHODS = ['GET', 'POST', 'OPTIONS'];

const normalizeBadgeDefinitions = (value) => {
  if (!Array.isArray(value)) return [];

  const deduped = new Map();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const id = String(entry.id || '').trim();
    const name = String(entry.name || '').trim();
    if (!id || !name) continue;

    deduped.set(id, {
      ...entry,
      id,
      name,
      description: typeof entry.description === 'string' ? entry.description : '',
      imageUrl: typeof entry.imageUrl === 'string' ? entry.imageUrl : '',
      category: typeof entry.category === 'string' ? entry.category : 'activity',
      rarity: typeof entry.rarity === 'string' ? entry.rarity : 'COMMON',
      xp: Number(entry.xp) || 0,
      mintFee: Number(entry.mintFee) || 0,
      criteria: Array.isArray(entry.criteria) ? entry.criteria : [],
      metadata:
        entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
          ? entry.metadata
          : {},
      enabled: entry.enabled !== false,
      onChainBadgeId:
        entry?.onChainBadgeId == null || entry?.onChainBadgeId === ''
          ? null
          : Number(entry.onChainBadgeId),
      createdAt: entry.createdAt || null,
      updatedAt: entry.updatedAt || null,
    });
  }

  return Array.from(deduped.values());
};

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
    const { badgeDefinitions } = await loadState();
    return sendJson(res, 200, badgeDefinitions || []);
  }

  const auth = checkAdmin(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const rawDefinitions = Array.isArray(req.body) ? req.body : req.body?.badges;
  const clearAwards = Boolean(req.body?.clearAwards);
  if (!Array.isArray(rawDefinitions)) {
    return sendJson(res, 400, { error: 'badges must be an array' });
  }
  if (rawDefinitions.length > 1000) {
    return sendJson(res, 400, { error: 'badges exceeds maximum size (1000)' });
  }

  const badgeDefinitions = normalizeBadgeDefinitions(rawDefinitions);
  if (badgeDefinitions.length === 0 && rawDefinitions.length > 0) {
    return sendJson(res, 400, { error: 'badges has no valid entries' });
  }

  const { userAwards, trackedAddresses, badgeConfigs } = await loadState();
  await saveState(
    clearAwards ? {} : userAwards,
    clearAwards ? [] : trackedAddresses,
    badgeConfigs,
    badgeDefinitions,
  );

  return sendJson(res, 200, {
    status: 'ok',
    count: badgeDefinitions.length,
    badges: badgeDefinitions,
    clearedAwards: clearAwards,
  });
}
