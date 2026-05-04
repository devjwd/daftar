/**
 * useUserLevel Hook (v3) — Server-Centralized
 * 
 * Centralizes XP and Level management by using the profile XP from the server.
 * Local XP calculation is removed to ensure the server is the single source of truth.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { getProfileAsync } from '../services/profileService';
import { getUserAwards, getBadgeById, syncUserAwardsFromBackend } from '../services/badges/badgeStore';
import {
  getLevelFromXP,
  getNextLevelXP,
  getLevelProgress,
} from '../config/badges';

/**
 * @param {string} address - User wallet address
 */
export function useUserLevel(address) {
  const [profileXP, setProfileXP] = useState(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const hydrate = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    
    try {
      // Sync profile (XP source) and awards (for badge list)
      const [profile] = await Promise.all([
        getProfileAsync(address).catch(() => null),
        syncUserAwardsFromBackend(address).catch(() => null)
      ]);

      if (profile && typeof profile.xp === 'number') {
        setProfileXP(profile.xp);
      } else {
        setProfileXP(0);
      }
      setVersion(v => v + 1);
    } catch (err) {
      console.warn('[useUserLevel] Hydration error:', err);
      setProfileXP(0);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Derived data based on XP
  const xp = profileXP ?? 0;
  const level = getLevelFromXP(xp);
  const nextLevelXP = getNextLevelXP(xp);
  const progress = getLevelProgress(xp);

  // Still fetch badge list for UI display if needed
  const badges = useMemo(() => {
    void version;
    if (!address) return [];
    const awards = getUserAwards(address);
    return awards
      .map((award) => {
        const badge = getBadgeById(award.badgeId);
        return badge ? { ...badge, earnedAt: award.awardedAt } : null;
      })
      .filter(Boolean);
  }, [address, version]);

  return {
    level,
    xp,
    nextLevelXP,
    xpProgress: progress.percentage,
    progressXP: progress.progressXP,
    requiredXP: progress.requiredXP,
    badges,
    loading: loading || profileXP === null,
    badgeCount: badges.length,
    refresh: hydrate,
  };
}

export default useUserLevel;
