/**
 * Badge Store
 * 
 * CRUD for badge definitions with localStorage persistence and server sync.
 * Emits events so UI can react to changes in real-time.
 */
import {
  BADGE_STORE_KEY,
  BADGE_AWARDS_KEY,
  BADGE_RULES,
  ACTIVITY_BADGE_TIERS,
  LONGEVITY_BADGE_TIERS,
  CRITERIA_TYPES,
  createBadgeDefinition,
  validateBadgeDefinition,
} from '../../config/badges.js';
import { awardBadgeToUser, fetchAllBadges, fetchUserBadges, saveBadgeDefinitions } from '../badgeApi.js';

const BADGE_STORE_META_KEY = 'movement_badges_meta_v1';
const STORE_SCHEMA_VERSION = 2;

function normalizeBadgeId(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `badge-${Date.now()}`;
}

function buildSystemBadges() {
  return [];
}

function normalizeLoadedBadge(rawBadge) {
  if (!rawBadge || typeof rawBadge !== 'object') return null;

  const id = rawBadge.id && !String(rawBadge.id).startsWith('badge_')
    ? normalizeBadgeId(rawBadge.id)
    : normalizeBadgeId(rawBadge.name || rawBadge.id);

  return {
    ...rawBadge,
    id,
    criteria: Array.isArray(rawBadge.criteria) ? rawBadge.criteria : [],
    metadata: rawBadge.metadata && typeof rawBadge.metadata === 'object' ? rawBadge.metadata : {},
  };
}

function migrateAndSeedBadges() {
  const rawBadges = readStore(BADGE_STORE_KEY, []);
  const storedMeta = readStore(BADGE_STORE_META_KEY, {});
  if (Number(storedMeta?.schemaVersion || 0) < STORE_SCHEMA_VERSION) {
    writeStore(BADGE_STORE_KEY, []);
    writeStore(BADGE_STORE_META_KEY, { schemaVersion: STORE_SCHEMA_VERSION, seededAt: Date.now() });
    return [];
  }

  const systemBadges = buildSystemBadges();
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

  for (const systemBadge of systemBadges) {
    if (!seen.has(systemBadge.id)) {
      merged.push(systemBadge);
      seen.add(systemBadge.id);
    }
  }

  const shouldPersist =
    merged.length !== rawBadges.length ||
    Number(storedMeta?.schemaVersion || 0) < STORE_SCHEMA_VERSION;

  if (shouldPersist) {
    writeStore(BADGE_STORE_KEY, merged);
    writeStore(BADGE_STORE_META_KEY, { schemaVersion: STORE_SCHEMA_VERSION, seededAt: Date.now() });
  }

  return merged;
}

function mapCriterionToRule(criterionType) {
  if (criterionType === CRITERIA_TYPES.TRANSACTION_COUNT) return BADGE_RULES.TRANSACTION_COUNT;
  if (criterionType === CRITERIA_TYPES.DAYS_ONCHAIN) return BADGE_RULES.DAYS_ONCHAIN;
  if (criterionType === CRITERIA_TYPES.MIN_BALANCE) return BADGE_RULES.MIN_BALANCE;
  if (criterionType === CRITERIA_TYPES.PROTOCOL_COUNT) return BADGE_RULES.PROTOCOL_COUNT;
  if (criterionType === CRITERIA_TYPES.PROTOCOL_USAGE || criterionType === CRITERIA_TYPES.DAPP_USAGE) return BADGE_RULES.DAPP_USAGE;
  if (criterionType === CRITERIA_TYPES.ALLOWLIST) return BADGE_RULES.ALLOWLIST;
  return null;
}

// ─── Event Emitter ───────────────────────────────────────────────────
const listeners = new Map();

function emit(event, data) {
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
function readStore(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? parsed : fallback;
    }
    if (fallback && typeof fallback === 'object') {
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function writeStore(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('[badgeStore] write error:', e);
  }
}

function replaceBadges(badges) {
  const normalized = Array.isArray(badges)
    ? badges.map(normalizeLoadedBadge).filter(Boolean)
    : [];
  writeStore(BADGE_STORE_KEY, normalized);
  writeStore(BADGE_STORE_META_KEY, { schemaVersion: STORE_SCHEMA_VERSION, seededAt: Date.now() });
  emit('badges:changed', normalized);
  return normalized;
}

function normalizeAward(address, award) {
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

function replaceAwardsForAddress(address, nextAwards) {
  const normalizedAddress = String(address || '').trim().toLowerCase();
  if (!normalizedAddress) return [];

  const awards = readStore(BADGE_AWARDS_KEY, []);
  const preserved = awards.filter((award) => award.address !== normalizedAddress);
  const normalizedAwards = Array.isArray(nextAwards)
    ? nextAwards.map((award) => normalizeAward(normalizedAddress, award)).filter(Boolean)
    : [];

  const merged = [...preserved, ...normalizedAwards];
  writeStore(BADGE_AWARDS_KEY, merged);
  emit('awards:changed', merged);
  return normalizedAwards;
}

async function persistBadgeList(badges, adminKey) {
  const response = await saveBadgeDefinitions({ badges, adminKey });
  if (!response.ok) {
    let message = response?.data?.error || 'Failed to save badge definitions';
    if (response.status === 503) {
      message = 'Server is not configured — set BADGE_ADMIN_API_KEY in Vercel environment variables and redeploy.';
    } else if (response.status === 401) {
      message = 'Wrong API key — the value you entered must exactly match BADGE_ADMIN_API_KEY in your Vercel settings (no extra spaces).';
    }
    return { success: false, errors: [message] };
  }

  const saved = Array.isArray(response?.data?.badges) ? response.data.badges : badges;
  replaceBadges(saved);
  return { success: true, badges: saved };
}

export async function syncBadgesFromBackend() {
  const cachedBadges = getAllBadges();
  const response = await fetchAllBadges();
  if (!response.ok) {
    return { ok: false, badges: cachedBadges };
  }

  const remoteBadges = Array.isArray(response.badges) ? response.badges : [];
  if (remoteBadges.length === 0 && cachedBadges.length > 0) {
    return { ok: true, badges: cachedBadges };
  }

  const badges = replaceBadges(remoteBadges);
  return { ok: true, badges };
}

export async function syncUserAwardsFromBackend(address) {
  if (!address) return { ok: true, awards: [] };

  const response = await fetchUserBadges(address);
  if (!response.ok) {
    return { ok: false, awards: getUserAwards(address) };
  }

  const awards = replaceAwardsForAddress(address, response.awards || []);
  return { ok: true, awards };
}

// ─── Badge Definition CRUD ───────────────────────────────────────────

/**
 * Get all badge definitions.
 * @returns {Array} badge definitions
 */
export function getAllBadges() {
  return migrateAndSeedBadges();
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
export async function createBadge(badgeData, options = {}) {
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
  const result = await persistBadgeList(badges, options.adminKey);
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
export async function updateBadge(id, updates, options = {}) {
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
  const result = await persistBadgeList(badges, options.adminKey);
  if (!result.success) return result;

  emit('badge:updated', updated);
  return { success: true, badge: updated };
}

/**
 * Delete a badge definition.
 * @param {string} id
 * @returns {{ success: boolean }}
 */
export async function deleteBadge(id, options = {}) {
  const badges = getAllBadges();
  const filtered = badges.filter(b => b.id !== id);

  if (filtered.length === badges.length) {
    return { success: false, errors: ['Badge not found'] };
  }

  const persistResult = await persistBadgeList(filtered, options.adminKey);
  if (!persistResult.success) return persistResult;

  // Also clean up awards for this badge
  const awards = readStore(BADGE_AWARDS_KEY, []);
  const cleanedAwards = awards.filter(a => a.badgeId !== id);
  writeStore(BADGE_AWARDS_KEY, cleanedAwards);

  emit('badge:deleted', { id });

  return { success: true };
}

/**
 * Toggle badge enabled/disabled.
 * @param {string} id
 * @returns {{ success: boolean, badge?: object }}
 */
export async function toggleBadge(id, options = {}) {
  const badge = getBadgeById(id);
  if (!badge) return { success: false, errors: ['Badge not found'] };
  return updateBadge(id, { enabled: !badge.enabled }, options);
}

/**
 * Reorder badges (for admin display order).
 * @param {string[]} orderedIds
 */
export function reorderBadges(orderedIds) {
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
export async function awardBadge(address, badgeId, extra = {}) {
  const normalized = String(address).toLowerCase();
  const resolvedBadge = getBadgeById(badgeId);
  if (!resolvedBadge) {
    return { success: false, errors: ['Badge definition not found'] };
  }

  const awards = readStore(BADGE_AWARDS_KEY, []);

  // Prevent duplicate awards
  if (awards.some(a => a.address === normalized && a.badgeId === badgeId)) {
    return { success: false, errors: ['Badge already awarded'] };
  }

  const award = {
    address: normalized,
    badgeId,
    awardedAt: Date.now(),
    txHash: extra.txHash || null,
    metadata: extra.metadata || {},
  };

  const remoteResult = await awardBadgeToUser(normalized, badgeId, {
    ...(extra.metadata || {}),
    txHash: extra.txHash || null,
    onChainBadgeId: extra.onChainBadgeId ?? resolvedBadge.onChainBadgeId ?? null,
  });

  if (remoteResult.ok && remoteResult.data) {
    const cachedAwards = getUserAwards(normalized);
    replaceAwardsForAddress(normalized, [...cachedAwards, remoteResult.data]);
    return { success: true, award: normalizeAward(normalized, remoteResult.data) };
  }

  awards.push(award);
  writeStore(BADGE_AWARDS_KEY, awards);
  emit('awards:changed', awards);

  return { success: true, award };
}

/**
 * Get all awards for a user.
 * @param {string} address
 * @returns {Array}
 */
export function getUserAwards(address) {
  const normalized = String(address).toLowerCase();
  return readStore(BADGE_AWARDS_KEY, []).filter(a => a.address === normalized);
}

/**
 * Check if a user has earned a specific badge.
 * @param {string} address
 * @param {string} badgeId
 * @returns {boolean}
 */
export function hasEarnedBadge(address, badgeId) {
  const normalized = String(address).toLowerCase();
  return readStore(BADGE_AWARDS_KEY, []).some(
    a => a.address === normalized && a.badgeId === badgeId
  );
}

/**
 * Get set of badge IDs earned by user.
 * @param {string} address
 * @returns {Set<string>}
 */
export function getEarnedBadgeIds(address) {
  const awards = getUserAwards(address);
  return new Set(awards.map(a => a.badgeId));
}

/**
 * Revoke a badge award.
 * @param {string} address
 * @param {string} badgeId
 */
export function revokeBadge(address, badgeId) {
  const normalized = String(address).toLowerCase();
  const awards = readStore(BADGE_AWARDS_KEY, []);
  const filtered = awards.filter(a => !(a.address === normalized && a.badgeId === badgeId));
  writeStore(BADGE_AWARDS_KEY, filtered);
  emit('awards:changed', filtered);
  return { success: true };
}

// ─── Bulk Operations ─────────────────────────────────────────────────

/**
 * Import badges from JSON.
 * @param {Array} badgeArray
 * @returns {{ imported: number, skipped: number, errors: string[] }}
 */
export async function importBadges(badgeArray, options = {}) {
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

  const result = await persistBadgeList(existing, options.adminKey);
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
 * Export scanner-compatible config for backend /api/badges/scan.
 * Only exports badges whose first criterion maps to a supported server rule.
 */
export function exportScannerConfigs() {
  const configs = [];

  for (const badge of getEnabledBadges()) {
    const firstCriterion = Array.isArray(badge.criteria) ? badge.criteria[0] : null;
    if (!firstCriterion?.type) continue;

    const rule = mapCriterionToRule(firstCriterion.type);
    if (rule == null) continue;

    configs.push({
      badgeId: badge.id,
      onChainBadgeId: badge.onChainBadgeId ?? null,
      rule,
      params: {
        badgeId: badge.id,
        ...(firstCriterion.params || {}),
      },
    });
  }

  return JSON.stringify(configs, null, 2);
}

/**
 * Clear all badge data (definitions and awards).
 */
export async function clearAllBadgeData(options = {}) {
  const response = await saveBadgeDefinitions({
    badges: [],
    adminKey: options.adminKey,
    clearAwards: true,
  });
  if (!response.ok) {
    return {
      success: false,
      errors: [response?.data?.error || 'Failed to clear badge data'],
    };
  }

  replaceBadges([]);
  writeStore(BADGE_AWARDS_KEY, []);
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
  toggleBadge,
  reorderBadges,
  awardBadge,
  getUserAwards,
  hasEarnedBadge,
  getEarnedBadgeIds,
  revokeBadge,
  importBadges,
  exportBadges,
  exportScannerConfigs,
  clearAllBadgeData,
  syncBadgesFromBackend,
  syncUserAwardsFromBackend,
};
