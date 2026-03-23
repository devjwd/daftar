import supabase from '../config/supabase.js';

const getBadgeApiBase = () => String(import.meta.env.VITE_BADGE_API_BASE || '').trim().replace(/\/+$/, '');

const buildBadgeApiUrl = (path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getBadgeApiBase();
  return base ? `${base}${normalizedPath}` : normalizedPath;
};

const parseJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const callBadgeApi = async ({ path, method = 'GET', body, headers = {} }) => {
  try {
    const response = await fetch(buildBadgeApiUrl(path), {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const data = await parseJsonSafe(response);
    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { error: String(error?.message || 'Network error') },
    };
  }
};

const normalizeAddress = (address) => {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return '';
  return value.startsWith('0x') ? value : `0x${value}`;
};

const mapBadgeRowToAward = (row) => ({
  id: row.id,
  badgeId: row.badge_id,
  badgeName: row.badge_name,
  rarity: row.rarity,
  xpValue: Number(row.xp_value || 0),
  awardedAt: row.claimed_at,
  payload: {
    badgeName: row.badge_name,
    rarity: row.rarity,
    xpValue: Number(row.xp_value || 0),
  },
});

const mapProfileRow = (row) => ({
  id: row.id,
  walletAddress: row.wallet_address,
  username: row.username,
  avatarUrl: row.avatar_url,
  xp: Number(row.xp || 0),
  createdAt: row.created_at,
});

export const fetchUserBadges = async (address) => {
  if (!address) return { ok: true, awards: [] };

  const walletAddress = normalizeAddress(address);
  const response = await callBadgeApi({
    path: `/api/badges/user/${encodeURIComponent(walletAddress)}`,
  });

  if (!response.ok) {
    console.warn('fetchUserBadges failed', response.status, response.data);
    return { ok: false, awards: [] };
  }

  const rows = Array.isArray(response.data) ? response.data : response.data?.awards;

  return {
    ok: true,
    awards: Array.isArray(rows)
      ? rows.map((row) => {
          if (row?.badge_id) return mapBadgeRowToAward(row);
          return {
            badgeId: String(row?.badgeId || ''),
            awardedAt: row?.awardedAt || null,
            payload:
              row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
                ? row.payload
                : {},
            txHash: row?.txHash || row?.payload?.txHash || null,
          };
        })
      : [],
  };
};

export const fetchAllBadges = async () => {
  const response = await callBadgeApi({ path: '/api/badges' });

  if (!response.ok) {
    console.warn('fetchAllBadges failed', response.status, response.data);
    return { ok: false, badges: [] };
  }

  return {
    ok: true,
    badges: Array.isArray(response.data?.badges) ? response.data.badges : [],
  };
};

export const saveBadgeDefinitions = async ({ badges, adminKey, clearAwards = false }) => {
  const response = await callBadgeApi({
    path: '/api/badges',
    method: 'POST',
    headers: {
      ...(adminKey ? { 'x-admin-key': adminKey } : {}),
    },
    body: {
      badges: Array.isArray(badges) ? badges : [],
      clearAwards: Boolean(clearAwards),
    },
  });

  return response;
};

export const awardBadgeToUser = async (address, badgeId, payload = {}) => {
  const walletAddress = normalizeAddress(address);
  const normalizedBadgeId = String(badgeId || '').trim();
  if (!walletAddress || !normalizedBadgeId) {
    return {
      ok: false,
      status: 400,
      data: { error: 'address and badgeId are required' },
    };
  }

  const response = await callBadgeApi({
    path: '/api/badges/claim',
    method: 'POST',
    body: {
      address: walletAddress,
      badgeId: normalizedBadgeId,
      payload: {
        ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
      },
    },
  });

  if (!response.ok) return response;

  const row = response.data;
  return {
    ok: true,
    status: response.status,
    data: {
      badgeId: String(row?.badgeId || normalizedBadgeId),
      awardedAt: row?.awardedAt || null,
      payload:
        row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? row.payload
          : {},
      txHash: row?.payload?.txHash || payload?.txHash || null,
    },
  };
};

export const fetchPublishedScannerConfigs = async () => {
  const response = await callBadgeApi({ path: '/api/badges/config' });
  if (!response.ok) {
    return {
      badgeConfigs: [],
      source: 'error',
      error: response.data?.error || 'Failed to load scanner config',
      httpStatus: response.status,
    };
  }

  return {
    badgeConfigs: Array.isArray(response.data?.badgeConfigs) ? response.data.badgeConfigs : [],
    source: response.data?.source || 'state',
  };
};

export const publishScannerConfigs = async ({ badgeConfigs, adminKey }) => {
  const response = await callBadgeApi({
    path: '/api/badges/config',
    method: 'POST',
    headers: {
      ...(adminKey ? { 'x-admin-key': adminKey } : {}),
    },
    body: {
      badgeConfigs: Array.isArray(badgeConfigs) ? badgeConfigs : [],
    },
  });

  if (!response.ok) {
    return {
      status: 'error',
      error: response.data?.error || 'Failed to publish scanner config',
      httpStatus: response.status,
    };
  }

  return {
    status: 'ok',
    count: Number(response.data?.count || 0),
    badgeConfigs: Array.isArray(response.data?.badgeConfigs) ? response.data.badgeConfigs : [],
  };
};

export const fetchUserProfile = async (address) => {
  const walletAddress = normalizeAddress(address);
  if (!walletAddress) {
    return { ok: false, profile: null, error: 'address is required' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, wallet_address, username, avatar_url, xp, created_at')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (error) {
    console.warn('fetchUserProfile failed', error);
    return { ok: false, profile: null, error: error.message || 'Failed to fetch profile' };
  }

  return {
    ok: true,
    profile: data ? mapProfileRow(data) : null,
  };
};

export const updateUserProfile = async (address, { username, avatarUrl } = {}) => {
  const walletAddress = normalizeAddress(address);
  if (!walletAddress) {
    return { ok: false, profile: null, error: 'address is required' };
  }

  const updates = {};
  if (username !== undefined) updates.username = username || null;
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl || null;

  const profileUpsert = await supabase
    .from('profiles')
    .upsert(
      {
        wallet_address: walletAddress,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address', ignoreDuplicates: true }
    );

  if (profileUpsert.error) {
    console.warn('updateUserProfile profile upsert failed', profileUpsert.error);
    return { ok: false, profile: null, error: profileUpsert.error.message || 'Failed to ensure profile' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('wallet_address', walletAddress)
    .select('id, wallet_address, username, avatar_url, xp, created_at')
    .single();

  if (error) {
    console.warn('updateUserProfile failed', error);
    return { ok: false, profile: null, error: error.message || 'Failed to update profile' };
  }

  return {
    ok: true,
    profile: mapProfileRow(data),
  };
};

export const searchProfiles = async (query, maxResults = 10) => {
  const term = String(query || '').trim();
  if (!term) return { ok: true, profiles: [] };

  const limit = Math.min(Math.max(Number(maxResults) || 10, 1), 10);
  const walletTerm = normalizeAddress(term);

  const selectFields = 'id, wallet_address, username, avatar_url, xp, created_at';

  const [walletResult, usernameResult] = await Promise.all([
    supabase
      .from('profiles')
      .select(selectFields)
      .ilike('wallet_address', `%${walletTerm}%`)
      .limit(limit),
    supabase
      .from('profiles')
      .select(selectFields)
      .ilike('username', `%${term}%`)
      .limit(limit),
  ]);

  if (walletResult.error && usernameResult.error) {
    console.warn('searchProfiles failed', walletResult.error, usernameResult.error);
    return { ok: false, profiles: [] };
  }

  if (walletResult.error) {
    console.warn('searchProfiles wallet query failed', walletResult.error);
  }
  if (usernameResult.error) {
    console.warn('searchProfiles username query failed', usernameResult.error);
  }

  const deduped = new Map();
  const mergedRows = [
    ...(Array.isArray(walletResult.data) ? walletResult.data : []),
    ...(Array.isArray(usernameResult.data) ? usernameResult.data : []),
  ];

  for (const row of mergedRows) {
    const key = row?.id || row?.wallet_address;
    if (!key || deduped.has(key)) continue;
    deduped.set(key, mapProfileRow(row));
    if (deduped.size >= limit) break;
  }

  return {
    ok: true,
    profiles: Array.from(deduped.values()),
  };
};

export default {
  fetchUserBadges,
  fetchAllBadges,
  saveBadgeDefinitions,
  awardBadgeToUser,
  fetchPublishedScannerConfigs,
  publishScannerConfigs,
  fetchUserProfile,
  updateUserProfile,
  searchProfiles,
};
