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
      } else {
        setProfileXP(0); // Default to 0 if profile doesn't exist or xp is missing
      }
      setAwardsVersion((v) => v + 1);
    } catch (err) {
      console.warn('Level hydration error:', err);
      setProfileXP(0);
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

  const badgeXP = useMemo(() => calculateTotalXP(badges), [badges]);
  const xp = Math.max(profileXP ?? 0, badgeXP);
  
  const level = xp !== null ? getLevelFromXP(xp) : 1;
  const nextLevelXP = xp !== null ? getNextLevelXP(xp) : 100;
  const progress = xp !== null ? getLevelProgress(xp) : { percentage: 0, progressXP: 0, requiredXP: 100 };

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
