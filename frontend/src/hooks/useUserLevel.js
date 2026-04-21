/**
 * useUserLevel Hook
 * 
 * Calculates user level based on earned badge XP.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { getUserAwards, getBadgeById, subscribe, syncUserAwardsFromBackend } from '../services/badges/badgeStore.js';
import { getProfileAsync } from '../services/profileService.js';
import {
  calculateTotalXP,
  getLevelFromXP,
  getNextLevelXP,
  getLevelProgress,
} from '../config/badges.js';

/**
 * @param {string} address - User wallet address
 */
export function useUserLevel(address) {
  const [awardsVersion, setAwardsVersion] = useState(0);
  const [profileXP, setProfileXP] = useState(null);
  const [loading, setLoading] = useState(false);

  const hydrate = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    
    // Sync badges & profile data
    try {
      const [profile] = await Promise.all([
        getProfileAsync(address).catch(() => null),
        syncUserAwardsFromBackend(address).catch(() => null)
      ]);

      if (profile && typeof profile.xp === 'number') {
        setProfileXP(profile.xp);
      } else if (!profile) {
        setProfileXP(0); // Explicitly zero if profile doesn't exist
      }
      setAwardsVersion((v) => v + 1);
    } catch (err) {
      console.warn('Level hydration error:', err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const badges = useMemo(() => {
    void awardsVersion;
    if (!address) return [];
    const awards = getUserAwards(address);
    return awards
      .map((award) => {
        const badge = getBadgeById(award.badgeId);
        return badge ? { ...badge, earnedAt: award.awardedAt } : null;
      })
      .filter(Boolean);
  }, [address, awardsVersion]);

  const xp = profileXP;
  const level = xp !== null ? getLevelFromXP(xp) : null;
  const nextLevelXP = xp !== null ? getNextLevelXP(xp) : null;
  const progress = xp !== null ? getLevelProgress(xp) : { percentage: 0, progressXP: 0, requiredXP: 0 };

  return {
    level,
    xp: xp ?? 0,
    nextLevelXP,
    xpProgress: progress.percentage,
    progressXP: progress.progressXP,
    requiredXP: progress.requiredXP,
    badges,
    loading: loading || xp === null,
    badgeCount: badges.length,
    refresh: hydrate,
  };
}

export default useUserLevel;
