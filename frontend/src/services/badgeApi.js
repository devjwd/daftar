import supabase from '../config/supabase.js';

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
  const { data, error } = await supabase
    .from('badges')
    .select('id, badge_id, badge_name, rarity, xp_value, claimed_at')
    .eq('wallet_address', walletAddress)
    .order('claimed_at', { ascending: false });

  if (error) {
    console.warn('fetchUserBadges failed', error);
    return { ok: false, awards: [] };
  }

  return {
    ok: true,
    awards: Array.isArray(data) ? data.map(mapBadgeRowToAward) : [],
  };
};

export const fetchAllBadges = async () => {
  const { data, error } = await supabase
    .from('badges')
    .select('id, wallet_address, badge_id, badge_name, rarity, xp_value, claimed_at')
    .order('claimed_at', { ascending: false });

  if (error) {
    console.warn('fetchAllBadges failed', error);
    return { ok: false, badges: [] };
  }

  return {
    ok: true,
    badges: Array.isArray(data) ? data : [],
  };
};

export const saveBadgeDefinitions = async ({ badges, adminKey, clearAwards = false }) => {
  void adminKey;
  void clearAwards;
  const payload = Array.isArray(badges) ? badges : [];
  return {
    ok: true,
    status: 200,
    data: { badges: payload },
  };
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

  const nowIso = new Date().toISOString();
  const badgeName = String(payload.badgeName || payload.badge_name || normalizedBadgeId);
  const rarity = String(payload.rarity || 'common');
  const xpValue = Number(payload.xpValue ?? payload.xp_value ?? 0) || 0;

  const profileUpsert = await supabase
    .from('profiles')
    .upsert(
      {
        wallet_address: walletAddress,
        created_at: nowIso,
      },
      { onConflict: 'wallet_address', ignoreDuplicates: true }
    );

  if (profileUpsert.error) {
    console.warn('awardBadgeToUser profile upsert failed', profileUpsert.error);
    return {
      ok: false,
      status: 500,
      data: { error: profileUpsert.error.message || 'Failed to ensure profile' },
    };
  }

  const { data, error } = await supabase
    .from('badges')
    .insert({
      wallet_address: walletAddress,
      badge_id: normalizedBadgeId,
      badge_name: badgeName,
      rarity,
      xp_value: xpValue,
      claimed_at: nowIso,
    })
    .select('id, wallet_address, badge_id, badge_name, rarity, xp_value, claimed_at')
    .single();

  if (error) {
    console.warn('awardBadgeToUser failed', error);
    return {
      ok: false,
      status: 500,
      data: { error: error.message || 'Failed to award badge' },
    };
  }

  const { data: profileData, error: profileFetchError } = await supabase
    .from('profiles')
    .select('xp')
    .eq('wallet_address', walletAddress)
    .single();

  if (profileFetchError) {
    console.warn('awardBadgeToUser profile fetch failed', profileFetchError);
  } else {
    const nextXp = Number(profileData?.xp || 0) + xpValue;
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({ xp: nextXp })
      .eq('wallet_address', walletAddress);
    if (profileUpdateError) {
      console.warn('awardBadgeToUser profile xp update failed', profileUpdateError);
    }
  }

  return {
    ok: true,
    status: 200,
    data: mapBadgeRowToAward(data),
  };
};

export const fetchPublishedScannerConfigs = async () => {
  return {
    badgeConfigs: [],
    source: 'supabase',
  };
};

export const publishScannerConfigs = async ({ badgeConfigs, adminKey }) => {
  void adminKey;
  return {
    status: 'ok',
    count: Array.isArray(badgeConfigs) ? badgeConfigs.length : 0,
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
