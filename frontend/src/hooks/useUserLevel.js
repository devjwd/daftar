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
  const [profileXP, setProfileXP] = useState(0);
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
      }
      setAwardsVersion((v) => v + 1);
    } catch (err) {
      console.warn('Level hydration error:', err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (!address) return undefined;

    const unsub = subscribe('awards:changed', () => {
      hydrate();
    });
    return unsub;
  }, [address, hydrate]);

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

  const xp = useMemo(() => profileXP, [profileXP]);
  const level = useMemo(() => getLevelFromXP(xp), [xp]);
  const nextLevelXP = useMemo(() => getNextLevelXP(xp), [xp]);
  const progress = useMemo(() => getLevelProgress(xp), [xp]);

  return {
    level,
    xp,
    nextLevelXP,
    xpProgress: progress.percentage,
    progressXP: progress.progressXP,
    requiredXP: progress.requiredXP,
    badges,
    loading,
    badgeCount: badges.length,
    refresh: hydrate,
  };
}

export default useUserLevel;
