/**
 * useBadges Hook
 * 
 * Provides a unified view of badges for a user:
 * - All badge definitions (from store)
 * - Eligibility status (from engine)
 * - Earned status (from awards)
 * - Real-time progress tracking
 */
import { useState, useEffect, useMemo } from 'react';
import useBadgeStore from './useBadgeStore.js';
import useBadgeEligibility from './useBadgeEligibility.js';
import { getEarnedBadgeIds, getUserAwards, subscribe } from '../services/badges/badgeStore.js';
import { POLLING_INTERVALS } from '../config/badges.js';
import { hasBadge } from '../services/badgeService.js';

const EMPTY_PRICE_MAP = {};

export const isBadgeEarned = (badgeId, earnedIds, onChainEarnedByBadgeId) => {
  return earnedIds.has(badgeId) || onChainEarnedByBadgeId.get(badgeId) === true;
};

export const shouldEvaluateBadgeEligibility = (badge, earnedIds, onChainEarnedByBadgeId) => {
  return !isBadgeEarned(badge.id, earnedIds, onChainEarnedByBadgeId);
};

/**
 * @param {string} address - Wallet address being viewed
 * @param {object} options
 * @param {object} options.client      - Aptos client instance
 * @param {object} options.priceMap    - Token price map for DeFi criteria
 * @param {number} options.pollInterval - Polling interval (ms)
 * @param {boolean} options.enablePolling - Enable/disable real-time polling
 */
export default function useBadges(address, options = {}) {
  const {
    client = null,
    priceMap = EMPTY_PRICE_MAP,
    pollInterval = POLLING_INTERVALS.ELIGIBILITY_CHECK,
    enablePolling = true,
  } = options;

  const { enabledBadges } = useBadgeStore();

  const [awardsVersion, setAwardsVersion] = useState(0);
  const [onChainEarnedByBadgeId, setOnChainEarnedByBadgeId] = useState(new Map());
  const [onChainSyncLoading, setOnChainSyncLoading] = useState(false);

  const earnedIds = useMemo(() => {
    void awardsVersion;
    if (!address) return new Set();
    return getEarnedBadgeIds(address);
  }, [address, awardsVersion]);

  const badgesToEvaluate = useMemo(
    () => enabledBadges.filter((badge) => shouldEvaluateBadgeEligibility(badge, earnedIds, onChainEarnedByBadgeId)),
    [enabledBadges, earnedIds, onChainEarnedByBadgeId]
  );

  const {
    loading: eligibilityLoading,
    refresh: refreshEligibility,
    isEligible,
    getResult,
    getProgress,
    eligibleCount,
  } = useBadgeEligibility(address, {
    badges: badgesToEvaluate,
    client,
    priceMap,
    pollInterval: enablePolling ? pollInterval : 0,
    enabled: !!address && badgesToEvaluate.length > 0,
  });

  // Load earned badge IDs
  useEffect(() => {
    if (!address) return undefined;

    const unsub = subscribe('awards:changed', () => {
      setAwardsVersion((v) => v + 1);
    });
    return unsub;
  }, [address]);

  // Reconcile local earned state with on-chain SBT ownership.
  useEffect(() => {
    let cancelled = false;

    const syncOnChainEarned = async () => {
      if (!address || !client) {
        setOnChainEarnedByBadgeId(new Map());
        return;
      }

      const onChainBadges = enabledBadges.filter((badge) => badge.onChainBadgeId != null);
      if (onChainBadges.length === 0) {
        setOnChainEarnedByBadgeId(new Map());
        return;
      }

      setOnChainSyncLoading(true);
      const results = await Promise.all(
        onChainBadges.map(async (badge) => {
          try {
            const earned = await hasBadge(client, Number(badge.onChainBadgeId), address);
            return [badge.id, earned];
          } catch {
            return [badge.id, false];
          }
        })
      );

      if (!cancelled) {
        setOnChainEarnedByBadgeId(new Map(results));
        setOnChainSyncLoading(false);
      }
    };

    syncOnChainEarned();

    return () => {
      cancelled = true;
    };
  }, [address, client, enabledBadges, awardsVersion]);

  // Build enriched badge list with eligibility & earned status
  const awardsByBadgeId = useMemo(() => {
    void awardsVersion;
    if (!address) return new Map();
    const awards = getUserAwards(address);
    return new Map(awards.map(award => [award.badgeId, award]));
  }, [address, awardsVersion]);

  const enrichedBadges = useMemo(() => {
    return enabledBadges.map(badge => {
      const earned = isBadgeEarned(badge.id, earnedIds, onChainEarnedByBadgeId);
      const evalResult = getResult(badge.id);
      const eligible = !earned && (evalResult?.eligible || false);
      const progress = evalResult?.overallProgress || 0;
      const criteriaResults = evalResult?.criteriaResults || [];

      // Find the award record for earned date
      let earnedDate = null;
      if (earned) {
        const award = awardsByBadgeId.get(badge.id);
        earnedDate = award?.awardedAt || null;
      }

      return {
        ...badge,
        earned,
        earnedDate,
        eligible,
        progress,
        criteriaResults,
        locked: !earned && !eligible,
      };
    });
  }, [enabledBadges, earnedIds, getResult, awardsByBadgeId, onChainEarnedByBadgeId]);

  // Categorized badge groups
  const earnedBadges = useMemo(() => enrichedBadges.filter(b => b.earned), [enrichedBadges]);
  const eligibleBadges = useMemo(() => enrichedBadges.filter(b => b.eligible && !b.earned), [enrichedBadges]);
  const lockedBadges = useMemo(() => enrichedBadges.filter(b => b.locked), [enrichedBadges]);

  // Stats
  const totalBadges = enabledBadges.length;
  const earnedCount = earnedBadges.length;
  const completionPercent = totalBadges > 0 ? Math.round((earnedCount / totalBadges) * 100) : 0;

  return {
    // All enriched badges
    badges: enrichedBadges,

    // Categorized
    earnedBadges,
    eligibleBadges,
    lockedBadges,

    // Stats
    totalBadges,
    earnedCount,
    eligibleCount,
    completionPercent,

    // Loading state
    loading: eligibilityLoading || onChainSyncLoading,

    // Methods
    refresh: refreshEligibility,
    isEligible,
    isEarned: (badgeId) => earnedIds.has(badgeId) || onChainEarnedByBadgeId.get(badgeId) === true,
    getProgress,
    getResult,
  };
}
