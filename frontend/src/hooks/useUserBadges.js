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
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!address) return undefined;

    // Re-load when awards change
    const unsub = subscribe('awards:changed', () => {
      setAwardsVersion((v) => v + 1);
    });
    return unsub;
  }, [address]);

  useEffect(() => {
    if (!address) return undefined;

    let active = true;

    const waitForRetry = () =>
      new Promise((resolve) => {
        window.setTimeout(resolve, 2000);
      });

    const hydrate = async () => {
      setLoading(true);
      setError(null);

      let result = await syncUserAwardsFromBackend(address);
      if (!result.ok) {
        await waitForRetry();
        if (!active) return;
        result = await syncUserAwardsFromBackend(address);
      }

      if (active) {
        if (!result.ok) {
          setError('Failed to load user badges.');
        }
        setAwardsVersion((v) => v + 1);
        setLoading(false);
      }
    };

    hydrate();

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
    loading: address ? loading : false,
    error: address ? error : null,
    count: earnedBadges.length,
  };
}
