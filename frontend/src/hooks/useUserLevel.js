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
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setBadges([]);
      return;
    }

    setLoading(true);

    const compute = () => {
      const awards = getUserAwards(address);
      const earned = awards
        .map(award => {
          const badge = getBadgeById(award.badgeId);
          return badge ? { ...badge, earnedAt: award.awardedAt } : null;
        })
        .filter(Boolean);

      setBadges(earned);
      setLoading(false);
    };

    compute();

    const unsub = subscribe('awards:changed', compute);
    return unsub;
  }, [address]);

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
    loading,
    badgeCount: badges.length,
  };
}

export default useUserLevel;
