/**
 * useUserBadges Hook
 * 
 * Simple hook to get a user's earned badges and awards.
 */
import { useState, useEffect, useMemo } from 'react';
import { getUserAwards, getBadgeById, subscribe, syncUserAwardsFromBackend } from '../services/badges/badgeStore.js';

export default function useUserBadges(address) {
  const [awardsVersion, setAwardsVersion] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return undefined;

    // Re-load when awards change
    const unsub = subscribe('awards:changed', () => {
      setAwardsVersion((v) => v + 1);
    });
    return unsub;
  }, [address]);

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      setLoading(true);
      await syncUserAwardsFromBackend(address);
      if (active) {
        setAwardsVersion((v) => v + 1);
        setLoading(false);
      }
    };

    if (address) hydrate();

    return () => {
      active = false;
    };
  }, [address]);

  const awards = useMemo(() => {
    void awardsVersion;
    if (!address) return [];
    return getUserAwards(address);
  }, [address, awardsVersion]);

  const earnedBadges = useMemo(() => {
    return awards
      .map((award) => {
        const badge = getBadgeById(award.badgeId);
        return badge ? { ...badge, earnedAt: award.awardedAt, txHash: award.txHash } : null;
      })
      .filter(Boolean);
  }, [awards]);

  return {
    awards,
    earnedBadges,
    earnedIds: new Set(awards.map(a => a.badgeId)),
    loading,
    count: earnedBadges.length,
  };
}
