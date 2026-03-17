/*
  Lightweight client for server-side badge endpoints.
  Used by the production badge system backed by Vercel Blob.
*/
const API_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BADGE_API_BASE) ||
  '';

const readJson = async (res) => {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

const requestJson = async (path, init) => {
  try {
    const res = await fetch(`${API_BASE}${path}`, init);
    const data = await readJson(res);
    return {
      ok: Boolean(res?.ok),
      status: res?.status || 0,
      data,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: e,
    };
  }
};

export const fetchUserBadges = async (address) => {
  if (!address) return { ok: true, awards: [] };

  const res = await requestJson(`/api/badges/user/${encodeURIComponent(address)}`);
  if (!res.ok && res.error) {
    console.warn('fetchUserBadges failed', res.error);
  }

  return {
    ok: res.ok,
    awards: Array.isArray(res.data) ? res.data : [],
  };
};

export const fetchAllBadges = async () => {
  const res = await requestJson('/api/badges');
  if (!res.ok && res.error) {
    console.warn('fetchAllBadges failed', res.error);
  }

  return {
    ok: res.ok,
    badges: Array.isArray(res.data) ? res.data : [],
  };
};

export const saveBadgeDefinitions = async ({ badges, adminKey, clearAwards = false }) => {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers['x-admin-key'] = adminKey;

  const res = await requestJson('/api/badges', {
    method: 'POST',
    headers,
    body: JSON.stringify({ badges: Array.isArray(badges) ? badges : [], clearAwards }),
  });

  if (!res.ok && res.error) {
    console.warn('saveBadgeDefinitions failed', res.error);
  }

  return {
    ok: res.ok,
    status: res.status,
    data: res.data,
  };
};

export const awardBadgeToUser = async (address, badgeId, payload = {}) => {
  const res = await requestJson('/api/badges/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, badgeId, payload }),
  });

  if (!res.ok && res.error) {
    console.warn('awardBadgeToUser failed', res.error);
  }

  return {
    ok: res.ok,
    status: res.status,
    data: res.data,
  };
};

export const fetchPublishedScannerConfigs = async () => {
  const res = await requestJson('/api/badges/config');
  if (!res.ok && res.error) {
    console.warn('fetchPublishedScannerConfigs failed', res.error);
  }
  if (!res.data || typeof res.data !== 'object') {
    return { badgeConfigs: [], source: res.ok ? 'unknown' : 'error' };
  }

  return {
    badgeConfigs: Array.isArray(res.data.badgeConfigs) ? res.data.badgeConfigs : [],
    source: String(res.data.source || 'unknown'),
  };
};

export const publishScannerConfigs = async ({ badgeConfigs, adminKey }) => {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers['x-admin-key'] = adminKey;

  const res = await requestJson('/api/badges/config', {
    method: 'POST',
    headers,
    body: JSON.stringify({ badgeConfigs: Array.isArray(badgeConfigs) ? badgeConfigs : [] }),
  });

  if (!res.ok && res.error) {
    console.warn('publishScannerConfigs failed', res.error);
  }

  return res.data || null;
};

export default {
  fetchUserBadges,
  fetchAllBadges,
  saveBadgeDefinitions,
  awardBadgeToUser,
  fetchPublishedScannerConfigs,
  publishScannerConfigs,
};
