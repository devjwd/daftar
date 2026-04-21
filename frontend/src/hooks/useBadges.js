import { useState, useEffect, useMemo, useCallback } from 'react';
import useBadgeStore from './useBadgeStore.js';
import { getEarnedBadgeIds, getUserAwards, subscribe, syncUserAwardsFromBackend } from '../services/badges/badgeStore.js';
import { hasBadge } from '../services/badgeService.js';
import { bulkCheckEligibility } from '../services/badges/engineService.js';

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
  const clientLoading = options.clientLoading === true;

  const { enabledBadges, loading: badgeStoreLoading } = useBadgeStore();

  const [awardsVersion, setAwardsVersion] = useState(0);
  const [onChainEarnedByBadgeId, setOnChainEarnedByBadgeId] = useState(new Map());
  const [eligibilityResults, setEligibilityResults] = useState(new Map());
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [onChainSyncLoading, setOnChainSyncLoading] = useState(false);
  const [error, setError] = useState(null);

  const earnedIds = useMemo(() => {
    void awardsVersion;
    if (!address) return new Set();
    return getEarnedBadgeIds(address);
  }, [address, awardsVersion]);

  const storeError = useMemo(() => {
    if (!address) return null;
    if (!badgeStoreLoading && enabledBadges.length === 0) {
      return 'No badge definitions are available right now.';
    }
    return null;
  }, [address, badgeStoreLoading, enabledBadges.length]);

  useEffect(() => {
    if (!address) return undefined;

    const unsub = subscribe('awards:changed', () => {
      setAwardsVersion((v) => v + 1);
    });
    return unsub;
  }, [address]);

  useEffect(() => {
    if (!address) return undefined;

    let active = true;

    const hydrateAwards = async () => {
      const result = await syncUserAwardsFromBackend(address);
      if (active) {
        if (!result.ok) {
          setError('Failed to load user badge awards.');
        } else {
          setError(null);
        }
        setAwardsVersion((v) => v + 1);
      }
    };

    hydrateAwards();

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
 
  // Real-time eligibility evaluation
  useEffect(() => {
    let cancelled = false;
 
    const evaluateAll = async () => {
      if (!address || enabledBadges.length === 0) {
        setEligibilityResults(new Map());
        return;
      }
 
      setEligibilityLoading(true);
      try {
        const results = await bulkCheckEligibility(address, enabledBadges);
        if (!cancelled) {
          const resultsMap = new Map(results.map((r) => [r.id, r]));
          setEligibilityResults(resultsMap);
        }
      } catch (err) {
        console.error('[useBadges] Eligibility evaluation failed:', err);
      } finally {
        if (!cancelled) {
          setEligibilityLoading(false);
        }
      }
    };
 
    evaluateAll();
 
    return () => {
      cancelled = true;
    };
  }, [address, enabledBadges]);

  const awardsByBadgeId = useMemo(() => {
    void awardsVersion;
    if (!address) return new Map();
    const awards = getUserAwards(address);
    return new Map(awards.map(award => [award.badgeId, award]));
  }, [address, awardsVersion]);

  const userBadges = useMemo(() => {
    return Array.from(awardsByBadgeId.values());
  }, [awardsByBadgeId]);

  const enrichedBadges = useMemo(() => {
    return enabledBadges.map(badge => {
      const earned = isBadgeEarned(badge.id, earnedIds, onChainEarnedByBadgeId);
      
      const elResult = eligibilityResults.get(badge.id);
      const eligible = elResult?.eligible === true;
      const progress = elResult?.progress || 0;
      const criteriaResults = elResult?.results || [];
 
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
        claimable: eligible && !earned && badge.onChainBadgeId != null,
        baseEligible: eligible,
        onChainMintable: badge.onChainBadgeId != null,
        publishPending: false,
        needsOnChainAttestation: false,
        onChainAllowlisted: false,
        attestationPending: false,
        attestationFailed: false,
        progress,
        criteriaResults,
        locked: !earned && !eligible,
        evaluationReason: elResult?.reason || null
      };
    });
  }, [enabledBadges, earnedIds, awardsByBadgeId, onChainEarnedByBadgeId, eligibilityResults]);

  // Categorized badge groups
  const earnedBadges = useMemo(() => enrichedBadges.filter(b => b.earned), [enrichedBadges]);
  const eligibleBadges = useMemo(() => enrichedBadges.filter(b => b.eligible && !b.earned), [enrichedBadges]);
  const lockedBadges = useMemo(() => enrichedBadges.filter(b => b.locked), [enrichedBadges]);

  // Stats
  const totalBadges = enabledBadges.length;
  const earnedCount = earnedBadges.length;
  const eligibleCount = eligibleBadges.length;
  const completionPercent = totalBadges > 0 ? Math.round((earnedCount / totalBadges) * 100) : 0;

  const refresh = useCallback(async () => {
    const result = await syncUserAwardsFromBackend(address);
    if (!result.ok) {
      setError('Failed to refresh user badge awards.');
    } else {
      setError(null);
    }
    setAwardsVersion((v) => v + 1);
  }, [address]);

  useEffect(() => {
    if (storeError) {
      console.warn('[useBadges] badge store is empty — check /api/badges response');
    }
  }, [storeError]);

  useEffect(() => {
    if (!address || badgeStoreLoading || onChainSyncLoading) return;
    if (userBadges.length === 0) {
      console.warn('[useBadges] no user awards found — check /api/badges/user/', address);
    }
  }, [address, badgeStoreLoading, onChainSyncLoading, userBadges.length]);

  const getResult = useCallback((badgeId) => eligibilityResults.get(badgeId) || null, [eligibilityResults]);
  const isEligible = useCallback((badgeId) => eligibilityResults.get(badgeId)?.eligible === true, [eligibilityResults]);
  const getProgress = useCallback((badgeId) => eligibilityResults.get(badgeId)?.progress || 0, [eligibilityResults]);

  return {
    // All enriched badges
    badges: enrichedBadges,
    userBadges,

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
    loading: badgeStoreLoading || onChainSyncLoading || (Boolean(address) && clientLoading),
    error: storeError || error,

    // Methods
    refresh,
    isEligible,
    isEarned: (badgeId) => earnedIds.has(badgeId) || onChainEarnedByBadgeId.get(badgeId) === true,
    getProgress,
    getResult,
  };
}
