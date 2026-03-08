/**
 * Eligibility Engine
 * 
 * Evaluates a user's eligibility for badges by running all criteria
 * evaluators. Supports caching, concurrent evaluation, and abort control.
 */
import { getCriterion } from './criteria/index.js';

// In-memory evaluation cache with TTL
const evaluationCache = new Map();
const CACHE_TTL = 15_000; // 15 seconds
const MAX_CACHE_ENTRIES = 300;

function pruneExpiredEntries(now = Date.now()) {
  for (const [key, cached] of evaluationCache.entries()) {
    if (!cached || now - cached.timestamp > CACHE_TTL) {
      evaluationCache.delete(key);
    }
  }
}

function enforceCacheLimit() {
  if (evaluationCache.size <= MAX_CACHE_ENTRIES) return;

  const entries = Array.from(evaluationCache.entries())
    .sort((a, b) => (a[1]?.timestamp || 0) - (b[1]?.timestamp || 0));

  const overflow = evaluationCache.size - MAX_CACHE_ENTRIES;
  for (let index = 0; index < overflow; index += 1) {
    evaluationCache.delete(entries[index][0]);
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${parts.join(',')}}`;
}

function getCriterionCacheKey(address, criterion) {
  return `${address.toLowerCase()}|${criterion.type}|${stableStringify(criterion.params || {})}`;
}

function getCacheKey(address, badgeId) {
  return `${address.toLowerCase()}:${badgeId}`;
}

function getCachedResult(address, badgeId) {
  pruneExpiredEntries();
  const key = getCacheKey(address, badgeId);
  const cached = evaluationCache.get(key);
  if (!cached) return null;
  return cached.result;
}

function setCachedResult(address, badgeId, result) {
  pruneExpiredEntries();
  const key = getCacheKey(address, badgeId);
  evaluationCache.set(key, { result, timestamp: Date.now() });
  enforceCacheLimit();
}

/**
 * Clear all cached evaluation results.
 */
export function clearEligibilityCache() {
  evaluationCache.clear();
}

/**
 * Clear cache for a specific user.
 * @param {string} address
 */
export function clearUserCache(address) {
  const prefix = address.toLowerCase() + ':';
  for (const key of evaluationCache.keys()) {
    if (key.startsWith(prefix)) {
      evaluationCache.delete(key);
    }
  }
}

/**
 * Evaluate a single badge criterion.
 * @param {string} address
 * @param {{ type: string, params: object }} criterion
 * @param {object} context
 * @returns {Promise<{ type, eligible, current, required, progress, label, error? }>}
 */
async function evaluateCriterion(address, criterion, context = {}) {
  const criterionCache = context.__criterionCache;
  const criterionKey = criterionCache ? getCriterionCacheKey(address, criterion) : null;

  if (criterionCache && criterionCache.has(criterionKey)) {
    return criterionCache.get(criterionKey);
  }

  const evaluationPromise = (async () => {
  const evaluator = getCriterion(criterion.type);
  if (!evaluator) {
    return {
      type: criterion.type,
      eligible: false,
      current: 0,
      required: 0,
      progress: 0,
      label: `Unknown criterion: ${criterion.type}`,
      error: 'No evaluator registered',
    };
  }

  try {
    const result = await evaluator.evaluate(address, criterion.params, context);
    return { type: criterion.type, ...result };
  } catch (error) {
    return {
      type: criterion.type,
      eligible: false,
      current: 0,
      required: 0,
      progress: 0,
      label: 'Evaluation error',
      error: error.message,
    };
  }
  })();

  if (criterionCache) {
    criterionCache.set(criterionKey, evaluationPromise);
  }

  return evaluationPromise;
}

/**
 * Evaluate all criteria for a single badge.
 * 
 * All criteria use AND logic: user must satisfy every criterion.
 * Returns aggregate result with per-criterion details.
 * 
 * @param {string} address  - User wallet address
 * @param {object} badge    - Badge definition with `criteria` array
 * @param {object} context  - Shared context (client, priceMap, etc.)
 * @param {object} options  - { useCache?: boolean, signal?: AbortSignal }
 * @returns {Promise<{
 *   badgeId: string,
 *   eligible: boolean,
 *   overallProgress: number,
 *   criteriaResults: Array,
 *   evaluatedAt: number,
 * }>}
 */
export async function evaluateBadge(address, badge, context = {}, options = {}) {
  const { useCache = true, signal } = options;

  // Check abort
  if (signal?.aborted) {
    throw new DOMException('Evaluation aborted', 'AbortError');
  }

  // Return cached if available
  if (useCache) {
    const cached = getCachedResult(address, badge.id);
    if (cached) return cached;
  }

  const criteria = badge.criteria || [];
  if (criteria.length === 0) {
    const result = {
      badgeId: badge.id,
      eligible: false,
      overallProgress: 0,
      criteriaResults: [],
      evaluatedAt: Date.now(),
    };
    setCachedResult(address, badge.id, result);
    return result;
  }

  // Evaluate all criteria concurrently
  const criteriaResults = await Promise.all(
    criteria.map(c => evaluateCriterion(address, c, context))
  );

  // Check abort again after async work
  if (signal?.aborted) {
    throw new DOMException('Evaluation aborted', 'AbortError');
  }

  // AND logic: all must be eligible
  const eligible = criteriaResults.every(r => r.eligible);

  // Aggregate progress: average of all criteria
  const overallProgress = criteriaResults.length > 0
    ? Math.round(criteriaResults.reduce((sum, r) => sum + (r.progress || 0), 0) / criteriaResults.length)
    : 0;

  const result = {
    badgeId: badge.id,
    eligible,
    overallProgress,
    criteriaResults,
    evaluatedAt: Date.now(),
  };

  setCachedResult(address, badge.id, result);
  return result;
}

/**
 * Evaluate all badges for a user.
 * 
 * @param {string} address     - User wallet address
 * @param {Array} badges       - Array of badge definitions
 * @param {object} context     - Shared context
 * @param {object} options     - { useCache, signal, concurrency }
 * @returns {Promise<Map<string, object>>} Map of badgeId → evaluation result
 */
export async function evaluateAllBadges(address, badges, context = {}, options = {}) {
  const { signal, concurrency = 3 } = options;
  const results = new Map();

  if (!address || !Array.isArray(badges) || badges.length === 0) {
    return results;
  }

  // Filter to enabled badges only
  const activeBadges = badges.filter(b => b.enabled !== false);
  const runContext = {
    ...context,
    __criterionCache: new Map(),
  };

  // Process in batches to avoid overwhelming the indexer
  for (let i = 0; i < activeBadges.length; i += concurrency) {
    if (signal?.aborted) break;

    const batch = activeBadges.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(badge => evaluateBadge(address, badge, runContext, options))
    );

    batchResults.forEach((settled, idx) => {
      if (settled.status === 'fulfilled') {
        results.set(batch[idx].id, settled.value);
      } else {
        results.set(batch[idx].id, {
          badgeId: batch[idx].id,
          eligible: false,
          overallProgress: 0,
          criteriaResults: [],
          evaluatedAt: Date.now(),
          error: settled.reason?.message || 'Evaluation failed',
        });
      }
    });
  }

  return results;
}

/**
 * Quick eligibility check for a single badge (no caching, lightweight).
 */
export async function isEligible(address, badge, context = {}) {
  const result = await evaluateBadge(address, badge, context, { useCache: false });
  return result.eligible;
}

export default {
  evaluateBadge,
  evaluateAllBadges,
  isEligible,
  clearEligibilityCache,
  clearUserCache,
};
