import { supabase } from '../config/supabase.js';
import { BADGE_RULES, CRITERIA_TYPES, criteriaToRuleType } from '../config/badges.js';

const parseJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const callLocalBadgeApi = async ({ path, method = 'GET', body, headers = {} }) => {
  try {
    const response = await fetch(path, {
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

const normalizeInteger = (value, fallback = 0) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const normalizeRuleParams = (criterion = {}) => {
  const params = criterion?.params && typeof criterion.params === 'object' ? criterion.params : {};

  if (criterion?.type === CRITERIA_TYPES.TRANSACTION_COUNT) {
    return { min_count: Math.max(1, normalizeInteger(params.minCount ?? params.count, 1)) };
  }

  if (criterion?.type === CRITERIA_TYPES.DAYS_ONCHAIN) {
    return { min_days: Math.max(1, normalizeInteger(params.minDays ?? params.days, 1)) };
  }

  if (criterion?.type === CRITERIA_TYPES.PROTOCOL_COUNT) {
    return { min_protocols: Math.max(1, normalizeInteger(params.minProtocols ?? params.count, 1)) };
  }

  if (criterion?.type === CRITERIA_TYPES.PROTOCOL_USAGE || criterion?.type === CRITERIA_TYPES.DAPP_USAGE) {
    return {
      dapp_key: String(params.protocol || params.dappKey || params.dapp || '').trim(),
      dapp_name: String(params.protocolName || params.dappName || '').trim(),
      dapp_contract: String(params.contract || params.dappContract || '').trim(),
    };
  }

  if (criterion?.type === CRITERIA_TYPES.MIN_BALANCE) {
    return {
      min_amount: Math.max(0, Number(params.minAmount ?? params.amount ?? 0) || 0),
      coin_type: String(params.coinType || '').trim(),
      decimals: Math.max(0, normalizeInteger(params.decimals, 8)),
    };
  }

  if (criterion?.type === CRITERIA_TYPES.ALLOWLIST) {
    return { mode: 'allowlist' };
  }

  return { ...params };
};

const getRuleDefinition = (badge = {}) => {
  const criteria = Array.isArray(badge?.criteria) ? badge.criteria.filter((criterion) => criterion?.type) : [];
  const firstCriterion = criteria[0] || null;

  if (!firstCriterion) {
    return {
      ruleType: BADGE_RULES.ATTESTATION,
      ruleParams: { mode: 'manual' },
    };
  }

  if (criteria.length > 1) {
    return {
      ruleType: BADGE_RULES.COMPOSITE,
      ruleParams: {
        criteria: criteria.map((criterion) => ({
          type: criterion.type,
          rule_type: criteriaToRuleType(criterion.type),
          params: normalizeRuleParams(criterion),
        })),
      },
    };
  }

  return {
    ruleType: criteriaToRuleType(firstCriterion.type),
    ruleParams: normalizeRuleParams(firstCriterion),
  };
};

const mapBadgeDefinitionRow = (row) => ({
  id: String(row?.badge_id || row?.id || '').trim(),
  name: String(row?.name || '').trim(),
  description: typeof row?.description === 'string' ? row.description : '',
  imageUrl: typeof row?.image_url === 'string' ? row.image_url : typeof row?.imageUrl === 'string' ? row.imageUrl : '',
  category: typeof row?.category === 'string' ? row.category : 'activity',
  rarity: typeof row?.rarity === 'string' ? row.rarity : 'COMMON',
  xp: Number(row?.xp_value ?? row?.xp ?? 0) || 0,
  mintFee: Number(row?.mint_fee ?? row?.mintFee ?? 0) || 0,
  criteria: Array.isArray(row?.criteria) ? row.criteria : [],
  metadata: row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {},
  isPublic: row?.is_public !== false && row?.isPublic !== false,
  enabled: row?.enabled !== false,
  ruleType: row?.rule_type ?? null,
  ruleParams: row?.rule_params && typeof row.rule_params === 'object' && !Array.isArray(row.rule_params) ? row.rule_params : {},
  onChainBadgeId:
    row?.on_chain_badge_id == null || row?.on_chain_badge_id === ''
      ? row?.onChainBadgeId == null || row?.onChainBadgeId === ''
        ? null
        : Number(row.onChainBadgeId)
      : Number(row.on_chain_badge_id),
  createdAt: row?.created_at || row?.createdAt || null,
  updatedAt: row?.updated_at || row?.updatedAt || null,
});

const mapBadgeDefinitionToRow = (badge) => {
  const badgeId = String(badge?.id || badge?.badge_id || '').trim();
  const { ruleType, ruleParams } = getRuleDefinition(badge);
  return {
    badge_id: badgeId,
    name: String(badge?.name || '').trim(),
    description: typeof badge?.description === 'string' ? badge.description : '',
    image_url: typeof badge?.imageUrl === 'string' ? badge.imageUrl : typeof badge?.image_url === 'string' ? badge.image_url : '',
    category: typeof badge?.category === 'string' ? badge.category : 'activity',
    rarity: typeof badge?.rarity === 'string' ? badge.rarity : 'COMMON',
    xp_value: Number(badge?.xp ?? badge?.xp_value ?? 0) || 0,
    mint_fee: Number(badge?.mintFee ?? badge?.mint_fee ?? 0) || 0,
    criteria: Array.isArray(badge?.criteria) ? badge.criteria : [],
    metadata: badge?.metadata && typeof badge.metadata === 'object' && !Array.isArray(badge.metadata) ? badge.metadata : {},
    is_public: badge?.isPublic !== false && badge?.is_public !== false,
    enabled: badge?.enabled !== false,
    is_active: badge?.enabled !== false,
    rule_type: ruleType,
    rule_params: ruleParams,
    on_chain_badge_id:
      badge?.onChainBadgeId == null || badge?.onChainBadgeId === ''
        ? badge?.on_chain_badge_id == null || badge?.on_chain_badge_id === ''
          ? null
          : Number(badge.on_chain_badge_id)
        : Number(badge.onChainBadgeId),
  };
};

const getErrorStatus = (error, fallback = 500) => Number(error?.context?.status || error?.status || fallback);

const getErrorMessage = (error, fallback = 'Request failed') =>
  String(error?.message || error?.context?.message || fallback);

const invokeAdminFunction = async (name, body, adminAuth = null) => {
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: adminAuth && typeof adminAuth === 'object' ? adminAuth : {},
  });

  return {
    ok: !error,
    status: error ? getErrorStatus(error) : 200,
    data: error ? { error: getErrorMessage(error) } : data,
  };
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
    .from('badge_attestations')
    .select('*, badge_definitions(*)')
    .eq('wallet_address', walletAddress)
    .eq('eligible', true);

  if (error) {
    console.warn('fetchUserBadges failed', error);
    return { ok: false, awards: [] };
  }

  const rows = Array.isArray(data) ? data : [];

  const awards = Array.isArray(rows)
    ? rows.map((row) => {
        if (row?.badge_id) {
          return mapBadgeRowToAward({
            ...row,
            badge_name: row?.badge_definitions?.name || row?.badge_name,
            rarity: row?.badge_definitions?.rarity || row?.rarity,
            xp_value: row?.badge_definitions?.xp_value ?? row?.xp_value,
            claimed_at: row?.claimed_at || row?.verified_at,
          });
        }
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
    : [];

  if (awards.length === 0) {
    console.warn('[badges] fetchUserBadges returned empty for:', address);
  }

  return {
    ok: true,
    awards,
  };
};

export const fetchAllBadges = async ({ includePrivate = false } = {}) => {
  const { data, error } = await supabase
    .from('badge_definitions')
    .select('*')
    .eq('is_active', true)
    .order('badge_id');

  if (error) {
    console.error('[badges] fetchAllBadges failed:', error.message || error);
    console.warn('fetchAllBadges failed', error);
    return { ok: false, badges: [] };
  }

  const badges = Array.isArray(data) ? data.map(mapBadgeDefinitionRow) : [];
  const resolvedBadges = includePrivate ? badges : badges.filter((badge) => badge.isPublic !== false);

  return {
    ok: true,
    badges: resolvedBadges,
  };
};

export const saveBadgeDefinitions = async ({ badges, adminAuth, clearAwards = false }) => {
  if (!adminAuth || typeof adminAuth !== 'object' || Object.keys(adminAuth).length === 0) {
    return {
      ok: false,
      status: 401,
      data: { error: 'Admin wallet approval is required' },
    };
  }

  const normalizedBadges = Array.isArray(badges) ? badges.map(mapBadgeDefinitionToRow).filter((badge) => badge.badge_id) : [];
  const current = await fetchAllBadges({ includePrivate: true });
  if (!current.ok) {
    return {
      ok: false,
      status: current.status || 500,
      data: { error: current.data?.error || 'Failed to load badge definitions before saving' },
    };
  }

  const existingRows = Array.isArray(current.badges) ? current.badges.map(mapBadgeDefinitionToRow) : [];
  const nextBadgeIds = new Set(normalizedBadges.map((badge) => badge.badge_id));

  for (const badge of existingRows) {
    if (nextBadgeIds.has(badge.badge_id)) continue;
    const result = await invokeAdminFunction('manage-badge-definition', {
      action: 'delete',
      badge: { badge_id: badge.badge_id },
    }, adminAuth);
    if (!result.ok) return result;
  }

  const existingBadgeIds = new Set(existingRows.map((badge) => badge.badge_id));
  for (const badge of normalizedBadges) {
    const action = existingBadgeIds.has(badge.badge_id) ? 'update' : 'create';
    const result = await invokeAdminFunction('manage-badge-definition', { action, badge }, adminAuth);
    if (!result.ok) return result;
  }

  return {
    ok: true,
    status: 200,
    data: {
      status: 'ok',
      count: normalizedBadges.length,
      badges: normalizedBadges.map(mapBadgeDefinitionRow),
      clearedAwards: Boolean(clearAwards) && false,
    },
  };
};

export const verifyBadge = async (wallet_address, badge_id) => {
  const { data, error } = await supabase.functions.invoke('verify-badge', {
    body: { wallet_address, badge_id },
  });
  return { data, error };
};

export const awardBadge = async (wallet_address, badge_id, adminAuth = null) => {
  const { data, error } = await supabase.functions.invoke('award-badge', {
    body: { wallet_address, badge_id },
    headers: adminAuth && typeof adminAuth === 'object' ? adminAuth : {},
  });
  return { data, error };
};

export const manageBadgeDefinition = async (action, badge, adminAuth = null) => {
  const { data, error } = await supabase.functions.invoke('manage-badge-definition', {
    body: { action, badge },
    headers: adminAuth && typeof adminAuth === 'object' ? adminAuth : {},
  });
  return { data, error };
};

export const getUserBadges = async (wallet_address) => {
  const { data } = await supabase
    .from('badge_attestations')
    .select('*, badge_definitions(*)')
    .eq('wallet_address', normalizeAddress(wallet_address))
    .eq('eligible', true);

  return Array.isArray(data) ? data : [];
};

export const awardBadgeToUser = async (address, badgeId, payload = {}, options = {}) => {
  const walletAddress = normalizeAddress(address);
  const normalizedBadgeId = String(badgeId || '').trim();
  const adminAuth = options?.adminAuth && typeof options.adminAuth === 'object' ? options.adminAuth : null;
  if (!walletAddress || !normalizedBadgeId) {
    return {
      ok: false,
      status: 400,
      data: { error: 'address and badgeId are required' },
    };
  }

  const response = await invokeAdminFunction('award-badge', {
    wallet_address: walletAddress,
    badge_id: normalizedBadgeId,
  }, adminAuth);

  if (!response.ok) return response;

  const awardedAt = new Date().toISOString();
  return {
    ok: true,
    status: response.status,
    data: {
      badgeId: normalizedBadgeId,
      awardedAt,
      payload:
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload
          : {},
      txHash: payload?.txHash || null,
    },
  };
};

export const fetchPublishedScannerConfigs = async () => {
  const response = await callLocalBadgeApi({ path: '/api/badges/config' });
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

export const publishScannerConfigs = async ({ badgeConfigs }) => {
  const response = await callLocalBadgeApi({
    path: '/api/badges/config',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
  verifyBadge,
  awardBadge,
  manageBadgeDefinition,
  getUserBadges,
  awardBadgeToUser,
  fetchPublishedScannerConfigs,
  publishScannerConfigs,
  fetchUserProfile,
  updateUserProfile,
  searchProfiles,
};
