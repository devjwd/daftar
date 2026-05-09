import { useState, useEffect, useCallback, useMemo } from 'react';
import { BadgeDefinition } from '@daftar/types';
import { getAllBadges, getUserAwards, subscribe, syncBadgesFromBackend, syncUserAwardsFromBackend } from '../services/badges/badgeStore';

interface UseBadgesOptions {
  client?: any;
  clientLoading?: boolean;
  enablePolling?: boolean;
}

interface UseBadgesResult {
  badges: any[];
  totalBadges: number;
  earnedCount: number;
  completionPercent: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useBadges = (address: string | null, options: UseBadgesOptions = {}): UseBadgesResult => {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        syncBadgesFromBackend(),
        address ? syncUserAwardsFromBackend(address, true) : Promise.resolve()
      ]);
      setVersion(v => v + 1);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh badges');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Subscribe to changes in the store
  useEffect(() => {
    const unsubBadges = subscribe('badges:changed', () => setVersion(v => v + 1));
    const unsubAwards = subscribe('awards:changed', () => setVersion(v => v + 1));
    return () => {
      unsubBadges();
      unsubAwards();
    };
  }, []);

  const data = useMemo(() => {
    void version;
    const allDefinitions = getAllBadges();
    const userAwards = address ? getUserAwards(address) : [];
    const earnedIds = new Set(userAwards.map(a => a.badgeId));

    const enrichedBadges = allDefinitions.map(def => ({
      ...def,
      earned: earnedIds.has(def.id),
      imageUrl: def.imageUrl || def.image_url || def.icon,
      onChainBadgeId: def.onChainBadgeId ?? def.on_chain_badge_id,
      xp: def.xp ?? def.xp_value ?? 0,
    }));

    const total = enrichedBadges.length;
    const earned = enrichedBadges.filter(b => b.earned).length;
    const percent = total > 0 ? Math.round((earned / total) * 100) : 0;

    return {
      badges: enrichedBadges,
      totalBadges: total,
      earnedCount: earned,
      completionPercent: percent
    };
  }, [address, version]);

  return {
    ...data,
    loading,
    error,
    refresh: fetchAll
  };
};
