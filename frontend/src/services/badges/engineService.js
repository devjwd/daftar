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
 * Uses lightweight aggregate data.
 */
export async function checkBadgeEligibility(address, badge) {
  try {
    const stats = await getAggregatedStats(address);
    const criteria = Array.isArray(badge.criteria) ? badge.criteria : [];

    if (criteria.length === 0) {
      return { eligible: true, results: [], reason: 'Manual/Attestation badge' };
    }

    // Currently support exactly one on-chain criterion as per contract v1
    const mainCriterion = criteria[0];
    const result = evaluateCriterion(mainCriterion.type, stats, mainCriterion.params);

    return {
      eligible: result.eligible,
      current: result.current,
      required: result.required,
      progress: result.progress,
      label: result.label,
      reason: result.eligible ? 'Criteria met' : (result.error || 'Criteria not met'),
      stats
    };
  } catch (error) {
    console.error('[EngineService] Check failed:', error);
    return { eligible: false, reason: 'Evaluation error', error: error.message };
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
      if (criteria.length === 0) return { id: badge.id, eligible: true, reason: 'Manual' };

      const result = evaluateCriterion(criteria[0].type, stats, criteria[0].params);
      return {
        id: badge.id,
        eligible: result.eligible,
        current: result.current,
        required: result.required,
        progress: result.progress,
        label: result.label,
        reason: result.eligible ? 'Criteria met' : (result.error || 'Criteria not met')
      };
    });
  } catch (error) {
    console.error('[EngineService] Bulk check failed:', error);
    return badges.map(b => ({ id: b.id, eligible: false, reason: 'Fetch error' }));
  }
}
