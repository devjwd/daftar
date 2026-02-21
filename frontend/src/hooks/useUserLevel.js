import { useState, useEffect, useMemo } from 'react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { DEFAULT_NETWORK } from '../config/network';
import { fetchBadges, hasBadge } from '../services/badgeService';
import { getLevelFromXP, getNextLevelXP, getRarityInfo } from '../config/badges';

/**
 * Hook to calculate user level based on earned badges
 * @param {string} address - User's wallet address
 * @returns {Object} { level, xp, nextLevelXP, xpProgress, badges, loading }
 */
export function useUserLevel(address) {
  const [level, setLevel] = useState(1);
  const [xp, setXP] = useState(0);
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(false);

  const movementClient = useMemo(
    () =>
      new Aptos(
        new AptosConfig({
          network: Network.CUSTOM,
          fullnode: DEFAULT_NETWORK.rpc,
        })
      ),
    []
  );

  useEffect(() => {
    if (!address) {
      setLevel(1);
      setXP(0);
      setBadges([]);
      return;
    }

    const calculateLevel = async () => {
      setLoading(true);
      try {
        // Fetch all available badges
        const allBadges = await fetchBadges(movementClient);
        
        // Check which badges user has earned
        let totalXP = 0;
        const userBadges = [];

        for (const badge of allBadges) {
          const earned = await hasBadge(movementClient, badge.id, address);
          if (earned) {
            userBadges.push(badge);
            // Calculate XP for this badge
            const rarity = getRarityInfo(badge.rarity || 'COMMON');
            const badgeXP = badge.xp || (rarity.level * 10);
            totalXP += badgeXP;
          }
        }

        setBadges(userBadges);
        setXP(totalXP);
        setLevel(getLevelFromXP(totalXP));
      } catch (err) {
        console.error('Failed to calculate user level:', err);
        setLevel(1);
        setXP(0);
        setBadges([]);
      } finally {
        setLoading(false);
      }
    };

    calculateLevel();
  }, [address, movementClient]);

  const nextLevelXP = getNextLevelXP(xp);
  const xpProgress = ((xp % 100) / 100) * 100;

  return {
    level,
    xp,
    nextLevelXP,
    xpProgress,
    badges,
    loading,
  };
}
