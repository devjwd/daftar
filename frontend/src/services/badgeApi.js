/*
  Lightweight client for server-side badge endpoints (optional).
  These endpoints are expected to exist on your backend if you persist awarded badges
  in a DB. The client gracefully handles missing endpoints by returning empty results.
*/
const API_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BADGE_API_BASE) ||
  '';

const safeJson = async (res) => {
  if (!res || !res.ok) {
    try {
      await res.text();
    } catch {
      return null;
    }
    return null;
  }
  return res.json();
};

export const fetchUserBadges = async (address) => {
  if (!address) return [];
  try {
    const res = await fetch(`${API_BASE}/api/badges/user/${encodeURIComponent(address)}`);
    const data = await safeJson(res);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('fetchUserBadges failed', e);
    return [];
  }
};

export const fetchAllBadges = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/badges`);
    const data = await safeJson(res);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('fetchAllBadges failed', e);
    return [];
  }
};

export const awardBadgeToUser = async (address, badgeId, payload = {}) => {
  try {
    const res = await fetch(`${API_BASE}/api/badges/award`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, badgeId, payload }),
    });
    const data = await safeJson(res);
    return data || null;
  } catch (e) {
    console.warn('awardBadgeToUser failed', e);
    return null;
  }
};

export default {
  fetchUserBadges,
  fetchAllBadges,
  awardBadgeToUser,
};
