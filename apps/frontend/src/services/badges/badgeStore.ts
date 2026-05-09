/**
 * Badge Store (v3) — Server-Optimized
 * 
 * CRUD for badge definitions with localStorage persistence and server sync.
 * User awards (who owns what) are NO LONGER stored in localStorage.
 * They are fetched from the server and kept in a reactive in-memory cache.
 * 
 * Emits events so UI can react to changes in real-time.
 */
import {
  BADGE_RULES,
  CRITERIA_TYPES,
  createBadgeDefinition,
  validateBadgeDefinition,
} from '../../config/badges';
import { awardBadgeToUser, fetchAllBadges, fetchUserBadges, saveBadgeDefinitions, manageBadgeDefinition } from '../api';

const BADGE_STORE_KEY = 'movement_badges_v3';
const BADGE_STORE_META_KEY = 'movement_badges_meta_v3';
const STORE_SCHEMA_VERSION = 3;
interface BadgeStoreMeta {
  schemaVersion?: number;
  seededAt?: number;
}

// In-memory cache for user awards (Source of truth is now the Server)
const AWARDS_CACHE = new Map(); // walletAddress -> Array of awards

// In-memory cache for badge definitions
let _badgesCache: any[] | null = null;

// Throttling for background syncs
const LAST_SYNC_TIMES = new Map();
const SYNC_COOLDOWN_MS = 5000; // Reduced to 5 seconds for snappier UI

function normalizeBadgeId(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `badge-${Date.now()}`;
}

function normalizeLoadedBadge(rawBadge) {
  if (!rawBadge || typeof rawBadge !== 'object') return null;

  // CRITICAL: Prefer Database UUID (badge_id or id)
  const id = rawBadge.badge_id || rawBadge.id || `badge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  return {
    ...rawBadge,
    id,
    imageUrl: rawBadge.imageUrl || rawBadge.image_url,
    xp: rawBadge.xp || rawBadge.xp_value || 0,
    isPublic: rawBadge.isPublic ?? rawBadge.is_public ?? true,
    onChainBadgeId: rawBadge.onChainBadgeId ?? rawBadge.on_chain_badge_id,
    criteria: Array.isArray(rawBadge.criteria) ? rawBadge.criteria : [],
    metadata: rawBadge.metadata && typeof rawBadge.metadata === 'object' ? rawBadge.metadata : {},
  };
}

function migrateAndSeedBadges() {
  const rawBadges = readStore(BADGE_STORE_KEY, []);
  const storedMeta = readStore<BadgeStoreMeta>(BADGE_STORE_META_KEY, {});
  
  // Early return if already on current schema to prevent redundant writes
  if (Number(storedMeta?.schemaVersion || 0) >= STORE_SCHEMA_VERSION) {
    return rawBadges.map(normalizeLoadedBadge).filter(Boolean);
  }

  if (Number(storedMeta?.schemaVersion || 0) < STORE_SCHEMA_VERSION) {
    writeStore(BADGE_STORE_KEY, []);
    writeStore(BADGE_STORE_META_KEY, { schemaVersion: STORE_SCHEMA_VERSION, seededAt: Date.now() });
    return [];
  }

  const merged = [];
  const seen = new Set();

  rawBadges
    .map(normalizeLoadedBadge)
    .filter(Boolean)
    .forEach((badge) => {
      if (seen.has(badge.id)) return;
      seen.add(badge.id);
      merged.push(badge);
    });

  // Always persist on migration to clean up internal state
  writeStore(BADGE_STORE_KEY, merged);
  writeStore(BADGE_STORE_META_KEY, { schemaVersion: STORE_SCHEMA_VERSION, seededAt: Date.now() });

  return merged;
}

function mapCriterionToRule(criterionType) {
  if (criterionType === CRITERIA_TYPES.TRANSACTION_COUNT) return BADGE_RULES.TRANSACTION_COUNT;
  if (criterionType === CRITERIA_TYPES.DAYS_ONCHAIN) return BADGE_RULES.DAYS_ONCHAIN;
  if (criterionType === CRITERIA_TYPES.MIN_BALANCE) return BADGE_RULES.MIN_BALANCE;
  if (criterionType === CRITERIA_TYPES.ALLOWLIST) return BADGE_RULES.ALLOWLIST;
  if (criterionType === CRITERIA_TYPES.DAFTAR_PROFILE_COMPLETE) return BADGE_RULES.DAFTAR_PROFILE_COMPLETE;
  if (criterionType === CRITERIA_TYPES.DAFTAR_SWAP_COUNT) return BADGE_RULES.DAFTAR_SWAP_COUNT;
  if (criterionType === CRITERIA_TYPES.DAFTAR_VOLUME_USD) return BADGE_RULES.DAFTAR_VOLUME_USD;
  return null;
}

// ─── Event Emitter ───────────────────────────────────────────────────
const listeners = new Map();

export function emit(event, data) {
  const handlers = listeners.get(event) || [];
  handlers.forEach(fn => {
    try { fn(data); } catch (e) { console.warn('[badgeStore] listener error:', e); }
  });
}

/**
 * Subscribe to store events.
 * Events: 'badges:changed', 'awards:changed', 'badge:created', 'badge:updated', 'badge:deleted'
 * @returns {() => void} unsubscribe function
 */
export function subscribe(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
  return () => {
    const arr = listeners.get(event) || [];
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  };
}

// ─── Storage Helpers ─────────────────────────────────────────────────
function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) {
      return (Array.isArray(parsed) ? parsed : fallback) as unknown as T;
    }
    if (fallback && typeof fallback === 'object') {
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback) as unknown as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, data: any) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('[badgeStore] write error:', e);
  }
}

export function replaceBadges(badges: any[]) {
  const normalized = Array.isArray(badges)
    ? badges.map(normalizeLoadedBadge).filter(Boolean)
    : [];
  _badgesCache = normalized; // Update cache
  writeStore(BADGE_STORE_KEY, normalized);
  writeStore(BADGE_STORE_META_KEY, { schemaVersion: STORE_SCHEMA_VERSION, seededAt: Date.now() });
  emit('badges:changed', normalized);
  return normalized;
}

function normalizeAward(address: string, award: any) {
  const normalizedAddress = String(address || '').trim().toLowerCase();
  if (!normalizedAddress || !award?.badgeId) return null;

  return {
    address: normalizedAddress,
    badgeId: String(award.badgeId),
    awardedAt: award?.awardedAt || Date.now(),
    txHash: award?.txHash || award?.payload?.txHash || null,
    metadata:
      award?.metadata && typeof award.metadata === 'object' && !Array.isArray(award.metadata)
        ? award.metadata
        : award?.payload && typeof award.payload === 'object' && !Array.isArray(award.payload)
          ? award.payload
          : {},
  };
}

function replaceAwardsForAddress(address: string, nextAwards: any[]) {
  const normalizedAddress = String(address || '').trim().toLowerCase();
  if (!normalizedAddress) return [];

  const normalizedAwards = Array.isArray(nextAwards)
    ? nextAwards.map((award) => normalizeAward(normalizedAddress, award)).filter(Boolean)
    : [];

  // Update In-Memory Cache (NOT localStorage)
  AWARDS_CACHE.set(normalizedAddress, normalizedAwards);
  
  emit('awards:changed', normalizedAwards);
  return normalizedAwards;
}

async function persistBadgeList(badges: any[], adminAuth: any) {
  const response = await saveBadgeDefinitions({ badges, adminAuth });
  if (!response.ok) {
    let message = (response as any)?.data?.error || 'Failed to save badge definitions';
    if (response.status === 401) {
      message = 'Admin wallet approval was rejected or is missing.';
    }
    return { success: false, errors: [message] };
  }

  const saved = Array.isArray((response as any)?.data?.badges) ? (response as any).data.badges : badges;
  replaceBadges(saved);
  return { success: true, badges: saved };
}

export async function syncBadgesFromBackend() {
  const cachedBadges = getAllBadges();
  const response = await fetchAllBadges({
    includePrivate: false,
  });
  
  if (!response.ok) {
    console.warn('[badgeStore] sync failed, falling back to cache');
    return { ok: false, badges: cachedBadges };
  }

  const remoteBadges = Array.isArray(response.badges) ? response.badges : [];
  
  // Overwrite local store with remote data to stay in sync (including empty list)
  const badges = replaceBadges(remoteBadges);
  return { ok: true, badges };
}

export async function syncUserAwardsFromBackend(address, force = false) {
  if (!address) return { ok: true, awards: [] };

  const normalized = address.toLowerCase();
  const now = Date.now();
  const lastSync = LAST_SYNC_TIMES.get(normalized) || 0;
  
  if (!force && (now - lastSync < SYNC_COOLDOWN_MS)) {
    return { ok: true, awards: getUserAwards(normalized), throttled: true };
  }

  LAST_SYNC_TIMES.set(normalized, now);
  const response = await fetchUserBadges(normalized);
  if (!response.ok) {
    return { ok: false, awards: getUserAwards(normalized) };
  }

  const awards = replaceAwardsForAddress(normalized, response.awards || []);
  return { ok: true, awards };
}

// ─── Badge Definition CRUD ───────────────────────────────────────────

/**
 * Get all badge definitions.
 * @returns {Array} badge definitions
 */
export function getAllBadges() {
  if (_badgesCache !== null) return _badgesCache;
  _badgesCache = migrateAndSeedBadges();
  return _badgesCache;
}

/**
 * Get a single badge by ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getBadgeById(id) {
  return getAllBadges().find(b => b.id === id) || null;
}

/**
 * Get badges by category.
 * @param {string} category
 * @returns {Array}
 */
export function getBadgesByCategory(category) {
  return getAllBadges().filter(b => b.category === category);
}

/**
 * Get only enabled badges.
 * @returns {Array}
 */
export function getEnabledBadges() {
  return getAllBadges().filter(b => b.enabled !== false);
}

/**
 * Create a new badge definition.
 * @param {object} badgeData
 * @returns {{ success: boolean, badge?: object, errors?: string[] }}
 */
export async function createBadge(badgeData: any, options: any = {}) {
  const badge = createBadgeDefinition(badgeData);
  const validation = validateBadgeDefinition(badge);

  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const badges = getAllBadges();

  // Check for duplicate names
  if (badges.some(b => b.name.toLowerCase() === badge.name.toLowerCase())) {
    return { success: false, errors: ['A badge with this name already exists'] };
  }

  badges.push(badge);
  const result = await persistBadgeList(badges, options.adminAuth);
  if (!result.success) return result;

  emit('badge:created', badge);
  return { success: true, badge };
}

/**
 * Update an existing badge definition.
 * @param {string} id
 * @param {object} updates - Partial badge data
 * @returns {{ success: boolean, badge?: object, errors?: string[] }}
 */
export async function updateBadge(id: string, updates: any, options: any = {}) {
  const badges = getAllBadges();
  const index = badges.findIndex(b => b.id === id);

  if (index < 0) {
    return { success: false, errors: ['Badge not found'] };
  }

  const updated = {
    ...badges[index],
    ...updates,
    id: badges[index].id,           // Prevent ID change
    createdAt: badges[index].createdAt,  // Preserve creation time
    updatedAt: Date.now(),
  };

  const validation = validateBadgeDefinition(updated);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  // Check duplicate names (excluding self)
  if (badges.some(b => b.id !== id && b.name.toLowerCase() === updated.name.toLowerCase())) {
    return { success: false, errors: ['A badge with this name already exists'] };
  }

  badges[index] = updated;
  const result = await persistBadgeList(badges, options.adminAuth);
  if (!result.success) return result;

  emit('badge:updated', updated);
  return { success: true, badge: updated };
}

/**
 * Delete a badge definition.
 * @param {string} id
 * @returns {{ success: boolean }}
 */
export async function deleteBadge(id: string, options: any = {}) {
  const badges = getAllBadges();
  const filtered = badges.filter(b => b.id !== id);

  if (filtered.length === badges.length) {
    return { success: false, errors: ['Badge not found'] };
  }

  const persistResult = await persistBadgeList(filtered, options.adminAuth);
  if (!persistResult.success) return persistResult;

  // Cleanup awards from cache for this badge
  AWARDS_CACHE.forEach((awards, address) => {
    const cleaned = awards.filter((a: any) => a.badgeId !== id);
    if (cleaned.length !== awards.length) {
      AWARDS_CACHE.set(address, cleaned);
    }
  });

  emit('badge:deleted', { id });

  return { success: true };
}

/**
 * Restore a soft-deleted badge definition.
 * @param {string} id
 * @returns {{ success: boolean }}
 */
export async function restoreBadge(id: string, options: any = {}) {
  const result = await manageBadgeDefinition('restore', { badge_id: id }, options.adminAuth);
  if ((result as any).error) {
    return { success: false, errors: [(result as any).error.message] };
  }

  // Refresh from backend to get the restored state
  await syncBadgesFromBackend();
  return { success: true };
}

/**
 * Toggle badge enabled/disabled.
 * @param {string} id
 * @returns {{ success: boolean, badge?: object }}
 */
export async function toggleBadge(id: string, options: any = {}) {
  const badge = getBadgeById(id);
  if (!badge) return { success: false, errors: ['Badge not found'] };
  return updateBadge(id, { enabled: !badge.enabled }, options);
}

/**
 * Reorder badges (for admin display order).
 * @param {string[]} orderedIds
 */
export function reorderBadges(orderedIds: string[]) {
  const badges = getAllBadges();
  const badgeMap = new Map(badges.map(b => [b.id, b]));
  const reordered = [];

  for (const id of orderedIds) {
    const badge = badgeMap.get(id);
    if (badge) {
      reordered.push(badge);
      badgeMap.delete(id);
    }
  }

  // Append any remaining badges not in the ordered list
  for (const badge of badgeMap.values()) {
    reordered.push(badge);
  }

  writeStore(BADGE_STORE_KEY, reordered);
  emit('badges:changed', reordered);
}

// ─── Badge Awards (user → earned badges) ─────────────────────────────

/**
 * Record that a user has earned a badge.
 * @param {string} address
 * @param {string} badgeId
 * @param {object} extra - Additional data (tx hash, etc.)
 */
export async function awardBadge(address: string, badgeId: string, extra: any = {}) {
  const normalized = String(address).toLowerCase();
  const resolvedBadge = getBadgeById(badgeId);
  if (!resolvedBadge) {
    return { success: false, errors: ['Badge definition not found'] };
  }

  // Prevent duplicate awards (check cache)
  const currentAwards = getUserAwards(normalized);
  if (currentAwards.some(a => a.badgeId === badgeId)) {
    return { success: false, errors: ['Badge already awarded'] };
  }

  const remoteResult = extra?.adminAuth
    ? await awardBadgeToUser(
      normalized,
      badgeId,
      {
        ...(extra.metadata || {}),
        txHash: extra.txHash || null,
        onChainBadgeId: extra.onChainBadgeId ?? resolvedBadge.onChainBadgeId ?? null,
      },
      { adminAuth: extra.adminAuth }
    )
    : { ok: false };

  if ((remoteResult as any).ok && (remoteResult as any).data) {
    const nextAwards = [...currentAwards, (remoteResult as any).data];
    replaceAwardsForAddress(normalized, nextAwards);
    return { success: true, award: normalizeAward(normalized, (remoteResult as any).data) };
  }

  // If not admin-authorized, we can't record the award ourselves in the new architecture.
  // The user must mint on-chain, and then we sync from the backend.
  return { 
    success: false, 
    errors: ['Award failed. Only admin or on-chain mints are supported in the simplified architecture.'] 
  };
}

/**
 * Get all awards for a user from the reactive cache.
 * @param {string} address
 * @returns {Array}
 */
export function getUserAwards(address: string) {
  if (!address) return [];
  const normalized = String(address).toLowerCase();
  return AWARDS_CACHE.get(normalized) || [];
}

/**
 * Check if a user has earned a specific badge.
 * @param {string} address
 * @param {string} badgeId
 * @returns {boolean}
 */
export function hasEarnedBadge(address: string, badgeId: string) {
  return getUserAwards(address).some(a => a.badgeId === badgeId);
}

/**
 * Get set of badge IDs earned by user.
 * @param {string} address
 * @returns {Set<string>}
 */
export function getEarnedBadgeIds(address: string) {
  const awards = getUserAwards(address);
  return new Set(awards.map(a => a.badgeId));
}

/**
 * Revoke a badge award (Admin only).
 * @param {string} address
 * @param {string} badgeId
 */
export function revokeBadge(address: string, badgeId: string) {
  const normalized = String(address).toLowerCase();
  const current = getUserAwards(normalized);
  const filtered = current.filter(a => a.badgeId !== badgeId);
  
  if (filtered.length !== current.length) {
    AWARDS_CACHE.set(normalized, filtered);
    emit('awards:changed', filtered);
  }
  return { success: true };
}

// ─── Bulk Operations ─────────────────────────────────────────────────

/**
 * Import badges from JSON.
 * @param {Array} badgeArray
 * @returns {{ imported: number, skipped: number, errors: string[] }}
 */
export async function importBadges(badgeArray: any[], options: any = {}) {
  if (!Array.isArray(badgeArray)) {
    return { imported: 0, skipped: 0, errors: ['Input must be an array'] };
  }

  const existing = getAllBadges();
  const existingNames = new Set(existing.map(b => b.name.toLowerCase()));
  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const data of badgeArray) {
    if (existingNames.has((data.name || '').toLowerCase())) {
      skipped++;
      continue;
    }

    const badge = createBadgeDefinition(data);
    const validation = validateBadgeDefinition(badge);
    if (validation.valid) {
      existing.push(badge);
      existingNames.add(badge.name.toLowerCase());
      imported++;
    } else {
      errors.push(`"${data.name}": ${validation.errors.join(', ')}`);
      skipped++;
    }
  }

  const result = await persistBadgeList(existing, options.adminAuth);
  if (!result.success) {
    return { imported: 0, skipped: badgeArray.length, errors: result.errors || ['Failed to save imported badges'] };
  }

  return { imported, skipped, errors };
}

/**
 * Export all badges as JSON.
 * @returns {string} JSON string
 */
export function exportBadges() {
  return JSON.stringify(getAllBadges(), null, 2);
}

/**
 * Clear all badge data (definitions and awards).
 */
export async function clearAllBadgeData(options: any = {}) {
  const response = await saveBadgeDefinitions({
    badges: [],
    adminAuth: options.adminAuth,
    clearAwards: true,
  });
  if (!response.ok) {
    return {
      success: false,
      errors: [(response as any)?.data?.error || 'Failed to clear badge data'],
    };
  }

  replaceBadges([]);
  AWARDS_CACHE.clear();
  writeStore(BADGE_STORE_META_KEY, {});
  emit('awards:changed', []);
  return { success: true };
}

export default {
  subscribe,
  getAllBadges,
  getBadgeById,
  getBadgesByCategory,
  getEnabledBadges,
  createBadge,
  updateBadge,
  deleteBadge,
  restoreBadge,
  toggleBadge,
  reorderBadges,
  awardBadge,
  getUserAwards,
  hasEarnedBadge,
  getEarnedBadgeIds,
  revokeBadge,
  importBadges,
  exportBadges,
  replaceBadges,
  clearAllBadgeData,
  syncBadgesFromBackend,
  syncUserAwardsFromBackend,
};
