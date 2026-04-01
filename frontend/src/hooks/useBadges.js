import { useState, useEffect, useMemo, useCallback } from 'react';
import useBadgeStore from './useBadgeStore.js';
import { getEarnedBadgeIds, getUserAwards, subscribe, syncUserAwardsFromBackend } from '../services/badges/badgeStore.js';
import { hasBadge } from '../services/badgeService.js';

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
  const { client = null } = options;

  const { enabledBadges, loading: badgeStoreLoading } = useBadgeStore();

  const [awardsVersion, setAwardsVersion] = useState(0);
  const [onChainEarnedByBadgeId, setOnChainEarnedByBadgeId] = useState(new Map());
  const [onChainSyncLoading, setOnChainSyncLoading] = useState(false);

  const earnedIds = useMemo(() => {
    void awardsVersion;
    if (!address) return new Set();
    return getEarnedBadgeIds(address);
  }, [address, awardsVersion]);

  useEffect(() => {
    if (!address) return undefined;

    const unsub = subscribe('awards:changed', () => {
      setAwardsVersion((v) => v + 1);
    });
    return unsub;
  }, [address]);

  useEffect(() => {
    let active = true;

    const hydrateAwards = async () => {
      await syncUserAwardsFromBackend(address);
      if (active) {
        setAwardsVersion((v) => v + 1);
      }
    };

    if (address) hydrateAwards();

    return () => {
      active = false;
    };
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

  const awardsByBadgeId = useMemo(() => {
    void awardsVersion;
    if (!address) return new Map();
    const awards = getUserAwards(address);
    return new Map(awards.map(award => [award.badgeId, award]));
  }, [address, awardsVersion]);

  const enrichedBadges = useMemo(() => {
    return enabledBadges.map(badge => {
      const earned = isBadgeEarned(badge.id, earnedIds, onChainEarnedByBadgeId);
      const progress = 0;
      const criteriaResults = [];

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
        eligible: false,
        claimable: false,
        baseEligible: false,
        onChainMintable: badge.onChainBadgeId != null,
        publishPending: false,
        needsOnChainAttestation: false,
        onChainAllowlisted: false,
        attestationPending: false,
        attestationFailed: false,
        progress,
        criteriaResults,
        locked: !earned,
      };
    });
  }, [enabledBadges, earnedIds, awardsByBadgeId, onChainEarnedByBadgeId]);

  // Categorized badge groups
  const earnedBadges = useMemo(() => enrichedBadges.filter(b => b.earned), [enrichedBadges]);
  const eligibleBadges = useMemo(() => [], []);
  const lockedBadges = useMemo(() => enrichedBadges.filter(b => b.locked), [enrichedBadges]);

  // Stats
  const totalBadges = enabledBadges.length;
  const earnedCount = earnedBadges.length;
  const eligibleCount = 0;
  const completionPercent = totalBadges > 0 ? Math.round((earnedCount / totalBadges) * 100) : 0;

  const refresh = useCallback(async () => {
    await syncUserAwardsFromBackend(address);
    setAwardsVersion((v) => v + 1);
  }, [address]);

  const getResult = useCallback(() => null, []);
  const isEligible = useCallback(() => false, []);
  const getProgress = useCallback(() => 0, []);

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
    loading: badgeStoreLoading || onChainSyncLoading,

    // Methods
    refresh,
    isEligible,
    isEarned: (badgeId) => earnedIds.has(badgeId) || onChainEarnedByBadgeId.get(badgeId) === true,
    getProgress,
    getResult,
  };
}
