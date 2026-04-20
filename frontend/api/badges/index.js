/**
 * GET/POST /api/badges
 * GET: returns full badge definitions for the public UI.
 * POST: replaces full badge definitions in Supabase state (admin only).
 */
import { checkAdmin } from '../_lib/auth.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import {
  loadResolvedBadgeDefinitions,
  loadStaticBadgeDefinitions,
  saveBadgeDefinitions,
  validateBadgeDefinitionsPayload,
} from '../_lib/badgeDefinitionsState.js';
import { loadState, saveState } from '../_lib/state.js';
import { getSupabaseAdmin } from './supabase.js';

const METHODS = ['GET', 'POST', 'OPTIONS'];

const wantsPrivate = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const mapBadgeDefinitionRow = (row) => ({
  id: String(row?.badge_id || '').trim(),
  name: String(row?.name || '').trim(),
  description: typeof row?.description === 'string' ? row.description : '',
  imageUrl: typeof row?.image_url === 'string' ? row.image_url : typeof row?.imageUrl === 'string' ? row.imageUrl : '',
  xp: Number(row?.xp_value ?? row?.xp ?? 0) || 0,
  mintFee: Number(row?.mint_fee ?? row?.mintFee ?? 0) || 0,
  criteria: Array.isArray(row?.criteria) ? row.criteria : [],
  metadata: row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {},
  isPublic: row?.is_public !== false && row?.isPublic !== false,
  enabled: row?.enabled !== false,
  onChainBadgeId:
    row?.on_chain_badge_id == null || row?.on_chain_badge_id === ''
      ? row?.onChainBadgeId == null || row?.onChainBadgeId === ''
        ? null
        : Number(row.onChainBadgeId)
      : Number(row.on_chain_badge_id),
  createdAt: row?.created_at || row?.createdAt || null,
  updatedAt: row?.updated_at || row?.updatedAt || null,
});

const loadBadgeDefinitionsFromSupabase = async () => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('badge_definitions')
    .select('*')
    .eq('is_active', true)
    .order('badge_id');

  if (error) {
    throw error;
  }

  const badges = Array.isArray(data)
    ? data.map(mapBadgeDefinitionRow).filter((badge) => badge.id && badge.name)
    : [];

  return { badges, source: 'supabase' };
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
    let badgeResponse;
    try {
      badgeResponse = await loadResolvedBadgeDefinitions();

      if (badgeResponse.source !== 'state' || !Array.isArray(badgeResponse.badges) || badgeResponse.badges.length === 0) {
        try {
          const supabaseResponse = await loadBadgeDefinitionsFromSupabase();
          if (Array.isArray(supabaseResponse.badges) && supabaseResponse.badges.length > 0) {
            badgeResponse = supabaseResponse;
          } else if (!Array.isArray(badgeResponse.badges) || badgeResponse.badges.length === 0) {
            console.warn('[definitions] Supabase empty, using static fallback');
            badgeResponse = { badges: loadStaticBadgeDefinitions(), source: 'static' };
          }
        } catch (supabaseError) {
          console.error('[definitions] Supabase query failed:', supabaseError);
          if (!Array.isArray(badgeResponse.badges) || badgeResponse.badges.length === 0) {
            console.warn('[definitions] State empty, using static fallback');
            badgeResponse = { badges: loadStaticBadgeDefinitions(), source: 'static' };
          }
        }
      }
    } catch (error) {
      console.error('[definitions] Failed to resolve badge definitions:', error);
      badgeResponse = { badges: loadStaticBadgeDefinitions(), source: 'static' };
    }

    const { badges, source } = badgeResponse;
    const includePrivate = wantsPrivate(req.query?.includePrivate);

    if (includePrivate) {
      const auth = checkAdmin(req);
      if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
      return sendJson(res, 200, { badges, source, includePrivate: true });
    }

    const publicBadges = badges.filter((badge) => badge?.isPublic !== false);
    return sendJson(res, 200, { badges: publicBadges, source, includePrivate: false });
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
