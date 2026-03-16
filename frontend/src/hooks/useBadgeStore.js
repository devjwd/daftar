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
  subscribe,
} from '../services/badges/badgeStore.js';

export default function useBadgeStore() {
  const [badges, setBadges] = useState(() => getAllBadges());
  const [version, setVersion] = useState(0);
  const enabledBadges = useMemo(
    () => badges.filter(b => b.enabled !== false),
    [badges]
  );

  // Subscribe to store changes
  useEffect(() => {
    const unsub = subscribe('badges:changed', (updated) => {
      setBadges(updated);
      setVersion(v => v + 1);
    });
    return unsub;
  }, []);

  const handleCreate = useCallback((data) => {
    const result = createBadge(data);
    return result;
  }, []);

  const handleUpdate = useCallback((id, updates) => {
    return updateBadge(id, updates);
  }, []);

  const handleDelete = useCallback((id) => {
    return deleteBadge(id);
  }, []);

  const handleToggle = useCallback((id) => {
    return toggleBadge(id);
  }, []);

  const handleImport = useCallback((data) => {
    return importBadges(data);
  }, []);

  const handleExport = useCallback(() => {
    return exportBadges();
  }, []);

  const handleExportScannerConfigs = useCallback(() => {
    return exportScannerConfigs();
  }, []);

  const handleClearAll = useCallback(() => {
    clearAllBadgeData();
  }, []);

  return {
    badges,
    enabledBadges,
    version,
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
