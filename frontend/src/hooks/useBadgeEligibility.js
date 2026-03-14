/**
 * useBadgeEligibility Hook
 * 
 * Real-time eligibility checking with polling, caching, and abort control.
 * Evaluates all badges for a given address and provides live progress.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { evaluateAllBadges, clearUserCache } from '../services/badges/eligibilityEngine.js';
import { POLLING_INTERVALS } from '../config/badges.js';

const EMPTY_BADGES = [];
const EMPTY_PRICE_MAP = {};

/**
 * @param {string} address     - User address to check eligibility for
 * @param {object} options
 * @param {Array} options.badges      - Badge definitions to evaluate
 * @param {object} options.client     - Aptos client instance
 * @param {object} options.priceMap   - Token price map
 * @param {number} options.pollInterval - Polling interval in ms (0 = no polling)
 * @param {boolean} options.enabled   - Whether to run evaluations
 */
export default function useBadgeEligibility(address, options = {}) {
  const {
    badges = EMPTY_BADGES,
    client = null,
    priceMap = EMPTY_PRICE_MAP,
    pollInterval = POLLING_INTERVALS.ELIGIBILITY_CHECK,
    enabled = true,
  } = options;

  const badgesRef = useRef(Array.isArray(badges) ? badges : []);
  const badgesKey = useMemo(() => {
    if (!Array.isArray(badges) || badges.length === 0) return '';
    return badges
      .map((badge) => `${badge.id}:${badge.updatedAt || badge.createdAt || 0}:${badge.enabled !== false ? 1 : 0}`)
      .sort()
      .join('|');
  }, [badges]);
  const hasBadgesToEvaluate = badgesKey.length > 0;

  const [results, setResults] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastEvaluated, setLastEvaluated] = useState(null);
  const [isTabVisible, setIsTabVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  const wasTabVisibleRef = useRef(isTabVisible);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const onVisibilityChange = () => {
      setIsTabVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    badgesRef.current = Array.isArray(badges) ? badges : [];
  }, [badges, badgesKey]);

  const evaluate = useCallback(async (opts = {}) => {
    const { silent = false } = opts;

    if (!address || !enabled || !hasBadgesToEvaluate) {
      if (mountedRef.current) {
        setResults(new Map());
        setLoading(false);
      }
      return;
    }

    // Abort any in-flight evaluation
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const context = { client, priceMap };
      const evalResults = await evaluateAllBadges(
        address,
        badgesRef.current,
        context,
        { signal: controller.signal, concurrency: 3 }
      );

      if (!mountedRef.current || controller.signal.aborted) return;

      setResults(evalResults);
      setLastEvaluated(Date.now());
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (mountedRef.current) {
        setError(err);
        console.error('[useBadgeEligibility] evaluation failed:', err);
      }
    } finally {
      if (mountedRef.current) {
        if (!silent) {
          setLoading(false);
        }
      }
    }
  }, [address, enabled, hasBadgesToEvaluate, client, priceMap]);

  // Initial evaluation and re-evaluate when address changes
  useEffect(() => {
    if (!address || !enabled || !hasBadgesToEvaluate) {
      setResults(new Map());
      setLoading(false);
      return;
    }

    evaluate({ silent: false });
  }, [address, enabled, hasBadgesToEvaluate, badgesKey, evaluate]);

  // Polling
  useEffect(() => {
    if (!address || !enabled || !hasBadgesToEvaluate || !isTabVisible || !pollInterval || pollInterval <= 0) return;

    const timer = setInterval(() => evaluate({ silent: true }), pollInterval);
    return () => clearInterval(timer);
  }, [address, enabled, hasBadgesToEvaluate, isTabVisible, pollInterval, evaluate]);

  useEffect(() => {
    const becameVisible = !wasTabVisibleRef.current && isTabVisible;
    wasTabVisibleRef.current = isTabVisible;

    if (becameVisible && address && enabled && hasBadgesToEvaluate && lastEvaluated) {
      evaluate({ silent: true });
    }
  }, [isTabVisible, address, enabled, hasBadgesToEvaluate, lastEvaluated, evaluate]);

  // Force refresh
  const refresh = useCallback(() => {
    if (address) {
      clearUserCache(address);
    }
    return evaluate({ silent: false });
  }, [address, evaluate]);

  // Convenience getters
  const getResult = useCallback((badgeId) => {
    return results.get(badgeId) || null;
  }, [results]);

  const isEligible = useCallback((badgeId) => {
    return results.get(badgeId)?.eligible || false;
  }, [results]);

  const getProgress = useCallback((badgeId) => {
    return results.get(badgeId)?.overallProgress || 0;
  }, [results]);

  const eligibleBadgeIds = new Set();
  for (const [id, result] of results) {
    if (result.eligible) eligibleBadgeIds.add(id);
  }

  return {
    results,
    loading,
    error,
    lastEvaluated,
    refresh,
    getResult,
    isEligible,
    getProgress,
    eligibleBadgeIds,
    eligibleCount: eligibleBadgeIds.size,
  };
}
