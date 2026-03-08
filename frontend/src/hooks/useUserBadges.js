/**
 * useUserBadges Hook
 * 
 * Simple hook to get a user's earned badges and awards.
 */
import { useState, useEffect } from 'react';
import { getUserAwards, getBadgeById, subscribe } from '../services/badges/badgeStore.js';

export default function useUserBadges(address) {
  const [awards, setAwards] = useState([]);
  const [earnedBadges, setEarnedBadges] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setAwards([]);
      setEarnedBadges([]);
      return;
    }

    setLoading(true);

    const loadAwards = () => {
      const userAwards = getUserAwards(address);
      setAwards(userAwards);

      // Hydrate with badge definitions
      const badges = userAwards
        .map(award => {
          const badge = getBadgeById(award.badgeId);
          return badge ? { ...badge, earnedAt: award.awardedAt, txHash: award.txHash } : null;
        })
        .filter(Boolean);

      setEarnedBadges(badges);
      setLoading(false);
    };

    loadAwards();

    // Re-load when awards change
    const unsub = subscribe('awards:changed', loadAwards);
    return unsub;
  }, [address]);

  return {
    awards,
    earnedBadges,
    earnedIds: new Set(awards.map(a => a.badgeId)),
    loading,
    count: earnedBadges.length,
  };
}
