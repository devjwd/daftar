import { fetchCoreEligibilityStats } from './dataCoordination.js';
import { evaluateCriterion } from './criteriaRegistry.js';

/**
 * High-Speed Evaluation Engine (v2)
 * 
 * Orchestrates lightweight data fetching and modular evaluation.
 */

const STATS_CACHE = new Map();
const CACHE_TTL = 30_000; // 30 seconds cache for stats

export async function getAggregatedStats(address) {
  const now = Date.now();
  const cached = STATS_CACHE.get(address.toLowerCase());

  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  const stats = await fetchCoreEligibilityStats(address);
  STATS_CACHE.set(address.toLowerCase(), { data: stats, timestamp: now });
  return stats;
}

export const evaluateBadge = checkBadgeEligibility;

/**
 * Check eligibility for a single badge against a wallet.
 * Uses lightweight aggregate data and evaluates ALL criteria.
 */
export async function checkBadgeEligibility(address, badge) {
  try {
    const stats = await getAggregatedStats(address);
    const criteria = Array.isArray(badge.criteria) ? badge.criteria : [];

    if (criteria.length === 0) {
      return { eligible: true, results: [], reason: 'Manual/Attestation badge', progress: 100 };
    }

    const results = criteria.map(c => {
      const res = evaluateCriterion(c.type, stats, c.params);
      return { ...res, type: c.type };
    });

    const eligible = results.every(r => r.eligible);
    const progress = results.length > 0
      ? Math.round(results.reduce((acc, r) => acc + (r.progress || 0), 0) / results.length)
      : 0;

    const failed = results.find(r => !r.eligible);

    return {
      eligible,
      current: eligible ? 1 : 0,
      required: 1,
      progress,
      results,
      reason: eligible ? 'All criteria met' : (failed?.label || failed?.error || 'Criteria not met'),
      stats
    };
  } catch (error) {
    console.error('[EngineService] Check failed:', error);
    return { eligible: false, reason: 'Evaluation error', error: error.message, progress: 0 };
  }
}

/**
 * Bulk check eligibility for multiple badges.
 * Fetches stats ONCE and evaluates all badges instantly.
 */
export async function bulkCheckEligibility(address, badges) {
  try {
    const stats = await getAggregatedStats(address);
    return badges.map(badge => {
      const criteria = Array.isArray(badge.criteria) ? badge.criteria : [];
      if (criteria.length === 0) return { id: badge.id, eligible: true, reason: 'Manual', progress: 100 };

      const results = criteria.map(c => evaluateCriterion(c.type, stats, c.params));
      const eligible = results.every(r => r.eligible);
      const progress = results.length > 0
        ? Math.round(results.reduce((acc, r) => acc + (r.progress || 0), 0) / results.length)
        : 0;
      
      const failed = results.find(r => !r.eligible);

      return {
        id: badge.id,
        eligible,
        progress,
        results,
        reason: eligible ? 'Criteria met' : (failed?.label || failed?.error || 'Criteria not met')
      };
    });
  } catch (error) {
    console.error('[EngineService] Bulk check failed:', error);
    return badges.map(b => ({ id: b.id, eligible: false, reason: 'Fetch error', progress: 0 }));
  }
}
