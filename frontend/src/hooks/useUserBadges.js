/**
 * useUserBadges Hook (v3) — Server-Centralized
 * 
 * Fetches and maintains a list of earned badges for a specific user.
 * Relies on badgeStore's in-memory cache populated from the server.
 */
import { useState, useEffect, useMemo } from 'react';
import { getUserAwards, getBadgeById, subscribe, syncUserAwardsFromBackend } from '../services/badges/badgeStore.js';

/**
 * @param {string} address - User wallet address
 */
export default function useUserBadges(address) {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Subscribe to reactive award changes
  useEffect(() => {
    if (!address) return undefined;
    const unsub = subscribe('awards:changed', () => {
      setVersion(v => v + 1);
    });
    return unsub;
  }, [address]);

  // Sync awards from backend on mount/address change
  useEffect(() => {
    if (!address) return undefined;

    let active = true;
    const hydrate = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await syncUserAwardsFromBackend(address);
        if (active) {
          if (!result.ok) {
            setError('Failed to load user badges.');
          }
          setVersion(v => v + 1);
        }
      } catch (err) {
        if (active) setError('Network error loading badges.');
      } finally {
        if (active) setLoading(false);
      }
    };

    hydrate();
    return () => { active = false; };
  }, [address]);

  const awards = useMemo(() => {
    void version;
    if (!address) return [];
    return getUserAwards(address);
  }, [address, version]);

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
