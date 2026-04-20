/**
 * useBadgeStore Hook
 * 
 * Provides reactive access to the badge store.
 * Automatically re-renders when badges change.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getAllBadges,
  getBadgesByCategory,
  getBadgeById,
  createBadge,
  updateBadge,
  deleteBadge,
  toggleBadge,
  importBadges,
  exportBadges,
  exportScannerConfigs,
  clearAllBadgeData,
  syncBadgesFromBackend,
  subscribe,
} from '../services/badges/badgeStore.js';

export default function useBadgeStore() {
  const [badges, setBadges] = useState(() => getAllBadges());
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const enabledBadges = useMemo(
    () => badges.filter(b => b.enabled !== false),
    [badges]
  );

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      setLoading(true);
      await syncBadgesFromBackend();
      if (active) setLoading(false);
    };

    hydrate();

    return () => {
      active = false;
    };
  }, []);

  // Subscribe to store changes
  useEffect(() => {
    const unsub = subscribe('badges:changed', (updated) => {
      setBadges(updated);
      setVersion(v => v + 1);
    });
    return unsub;
  }, []);

  const handleCreate = useCallback(async (data, options) => {
    return createBadge(data, options);
  }, []);

  const handleUpdate = useCallback(async (id, updates, options) => {
    return updateBadge(id, updates, options);
  }, []);

  const handleDelete = useCallback(async (id, options) => {
    return deleteBadge(id, options);
  }, []);

  const handleToggle = useCallback(async (id, options) => {
    return toggleBadge(id, options);
  }, []);

  const handleImport = useCallback(async (data, options) => {
    return importBadges(data, options);
  }, []);

  const handleExport = useCallback(() => {
    return exportBadges();
  }, []);

  const handleExportScannerConfigs = useCallback(() => {
    return exportScannerConfigs();
  }, []);

  const handleClearAll = useCallback(async (options) => {
    return clearAllBadgeData(options);
  }, []);

  return {
    badges,
    enabledBadges,
    version,
    loading,
    getBadgeById,
    getBadgesByCategory,
    createBadge: handleCreate,
    updateBadge: handleUpdate,
    deleteBadge: handleDelete,
    toggleBadge: handleToggle,
    importBadges: handleImport,
    exportBadges: handleExport,
    exportScannerConfigs: handleExportScannerConfigs,
    clearAll: handleClearAll,
  };
}
