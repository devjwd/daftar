/// <reference types="vite/client" />
/**
 * Engine Service (v3) — Server-Delegated
 * 
 * All eligibility evaluation is now done server-side.
 * This module is a thin API client that preserves the same export signatures
 * so existing consumers (useBadges, useBadgeEligibility, Badges.jsx) don't break.
 */

const API_URL = import.meta.env.VITE_API_URL || '';
const CACHE = new Map();
const CACHE_TTL = 30_000; // 30 seconds

import { normalizeAddress } from '../../utils/address';

/**
 * Fetch bulk eligibility results from the server.
 * Returns a Map of badge_id → { eligible, reason, progress }
 */
async function fetchServerEligibility(address: string) {
  const normalized = normalizeAddress(address);
  const cacheKey = `bulk:${normalized}`;
  const cached = CACHE.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  try {
    const response = await fetch(`${API_URL}/api/badges/eligibility/bulk?wallet=${normalized}`);
    if (!response.ok) {
      console.warn('[EngineService] Server eligibility check failed:', response.status);
      return new Map();
    }

    const json = await response.json();
    const resultMap = new Map();
    (json.results || []).forEach((r: any) => {
      resultMap.set(r.badge_id, {
        eligible: r.eligible,
        reason: r.reason || '',
        progress: r.progress || 0,
        fromCache: r.fromCache || false,
      });
    });

    CACHE.set(cacheKey, { data: resultMap, timestamp: Date.now() });
    return resultMap;
  } catch (err) {
    console.error('[EngineService] Fetch failed:', err);
    return new Map();
  }
}

/**
 * Check eligibility for a single badge against a wallet.
 * Delegates to the server's bulk endpoint (cached).
 */
export async function checkBadgeEligibility(badgeId: string, address: string) {
  try {
    const resultMap = await fetchServerEligibility(address);
    const result = resultMap.get(badgeId);

    if (result) {
      return {
        eligible: result.eligible,
        reason: result.reason,
        progress: result.progress,
        results: [],
        current: result.eligible ? 1 : 0,
        required: 1,
      };
    }

    // Badge not found in server results — might be a manual/attestation badge
    return {
      eligible: false,
      reason: 'Not evaluated by server',
      progress: 0,
      results: [],
      current: 0,
      required: 1,
    };
  } catch (error: any) {
    console.error('[EngineService] Check failed:', error);
    return { eligible: false, reason: 'Evaluation error', error: error.message, progress: 0 };
  }
}

// Alias for backward compatibility
export const evaluateBadge = checkBadgeEligibility;

/**
 * Bulk check eligibility for multiple badges.
 * Fetches from server ONCE and maps results.
 */
export async function bulkCheckEligibility(address: string, badges: any[]) {
  try {
    const resultMap = await fetchServerEligibility(address);

    return (badges || []).map(badge => {
      const badgeId = badge?.badge_id || badge?.id || '';
      const result = resultMap.get(badgeId);

      if (result) {
        return {
          id: badgeId,
          eligible: result.eligible,
          reason: result.reason,
          progress: result.progress,
          results: [],
        };
      }

      return {
        id: badgeId,
        eligible: false,
        reason: 'Not evaluated',
        progress: 0,
        results: [],
      };
    });
  } catch (error) {
    console.error('[EngineService] Bulk check failed:', error);
    return (badges || []).map(b => ({
      id: b?.badge_id || b?.id || '',
      eligible: false,
      reason: 'Fetch error',
      progress: 0,
    }));
  }
}

/**
 * Clear the eligibility cache (e.g., after a mint).
 */
export function clearEligibilityCache(address: string) {
  if (address) {
    CACHE.delete(`bulk:${normalizeAddress(address)}`);
  } else {
    CACHE.clear();
  }
}
