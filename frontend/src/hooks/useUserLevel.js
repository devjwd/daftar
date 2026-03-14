/**
 * useUserLevel Hook
 * 
 * Calculates user level based on earned badge XP.
 */
import { useState, useEffect, useMemo } from 'react';
import { getUserAwards, getBadgeById, subscribe } from '../services/badges/badgeStore.js';
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

  useEffect(() => {
    if (!address) return undefined;

    const unsub = subscribe('awards:changed', () => {
      setAwardsVersion((v) => v + 1);
    });
    return unsub;
  }, [address]);

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

  const xp = useMemo(() => calculateTotalXP(badges), [badges]);
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
    loading: false,
    badgeCount: badges.length,
  };
}

export default useUserLevel;
