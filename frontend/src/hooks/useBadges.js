import { useState, useEffect, useMemo, useCallback } from 'react';
import useBadgeStore from './useBadgeStore.js';
import { getEarnedBadgeIds, getUserAwards, subscribe, syncUserAwardsFromBackend } from '../services/badges/badgeStore.js';
import { bulkCheckEligibility } from '../services/badges/engineService.js';

export const isBadgeEarned = (badgeId, earnedIds) => {
  return earnedIds.has(badgeId);
};

export const shouldEvaluateBadgeEligibility = (badge, earnedIds) => {
  return !isBadgeEarned(badge.id, earnedIds);
};

/**
 * useBadges — Simplified Architecture
 * 
 * Aggregates badge definitions, user awards, and server-evaluated eligibility.
 * All logic is centralized on the server; this hook is a pure consumer.
 * 
 * @param {string} address - Wallet address being viewed
 * @param {object} options
 */
export default function useBadges(address, options = {}) {
  const { enabledBadges, loading: badgeStoreLoading } = useBadgeStore();

  const [awardsVersion, setAwardsVersion] = useState(0);
  const [eligibilityResults, setEligibilityResults] = useState(new Map());
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
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

  // Listen for award changes (e.g., after a successful mint/sync)
  useEffect(() => {
    if (!address) return undefined;

    const unsub = subscribe('awards:changed', () => {
      setAwardsVersion((v) => v + 1);
    });
    return unsub;
  }, [address]);

  // Sync awards from server on mount/address change
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
    return () => { active = false; };
  }, [address]);

  // Fetch bulk eligibility from server
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
    return () => { cancelled = true; };
  }, [address, enabledBadges, awardsVersion]); // Re-evaluate when awards change (to catch "already owned" status)

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
      const earned = isBadgeEarned(badge.id, earnedIds);
      
      const elResult = eligibilityResults.get(badge.id);
      const eligible = elResult?.eligible === true;
      const progress = elResult?.progress || 0;
      const criteriaResults = elResult?.results || [];

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
        onChainMintable: badge.onChainBadgeId != null,
        progress,
        criteriaResults,
        locked: !earned && !eligible,
        evaluationReason: elResult?.reason || null
      };
    });
  }, [enabledBadges, earnedIds, awardsByBadgeId, eligibilityResults]);

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
    const result = await syncUserAwardsFromBackend(address, true);
    if (!result.ok) {
      setError('Failed to refresh user badge awards.');
    } else {
      setError(null);
    }
    setAwardsVersion((v) => v + 1);
  }, [address]);

  const getResult = useCallback((badgeId) => eligibilityResults.get(badgeId) || null, [eligibilityResults]);
  const isEligible = useCallback((badgeId) => eligibilityResults.get(badgeId)?.eligible === true, [eligibilityResults]);
  const getProgress = useCallback((badgeId) => eligibilityResults.get(badgeId)?.progress || 0, [eligibilityResults]);

  return {
    badges: enrichedBadges,
    userBadges,
    earnedBadges,
    eligibleBadges,
    lockedBadges,
    totalBadges,
    earnedCount,
    eligibleCount,
    completionPercent,
    loading: badgeStoreLoading || eligibilityLoading,
    error: storeError || error,
    refresh,
    isEligible,
    isEarned: (badgeId) => earnedIds.has(badgeId),
    getProgress,
    getResult,
  };
}
