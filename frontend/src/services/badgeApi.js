import { supabase } from '../config/supabase.js';
import { BADGE_RULES, CRITERIA_TYPES, criteriaToRuleType } from '../config/badges.js';
import { devLog } from '../utils/devLogger.js';

const parseJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const callLocalBadgeApi = async ({ path, method = 'GET', body, headers = {} }) => {
  const baseUrl = import.meta.env.VITE_API_URL || '';
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
  
  try {
    const response = await fetch(url, {
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
  rarity: 'COMMON',
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

export const mapBadgeDefinitionToRow = (badge) => {
  const badgeId = String(badge?.id || badge?.badge_id || '').trim();
  const { ruleType, ruleParams } = getRuleDefinition(badge);
  return {
    badge_id: badgeId,
    name: String(badge?.name || '').trim(),
    description: typeof badge?.description === 'string' ? badge.description : '',
    image_url: typeof badge?.imageUrl === 'string' ? badge.imageUrl : typeof badge?.image_url === 'string' ? badge.image_url : '',
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

const invokeAdminFunction = async (path, body, adminAuth = null) => {
  const response = await callLocalBadgeApi({
    path,
    method: 'POST',
    body,
    headers: adminAuth && typeof adminAuth === 'object' ? adminAuth : {},
  });

  return response;
};

const resolveAdminHeaders = async (adminAuth, body) => {
  if (typeof adminAuth === 'function') {
    return await adminAuth(body);
  }
  return adminAuth;
};

const mapBadgeRowToAward = (row) => ({
  id: row.id,
  badgeId: row.badge_id,
  badgeName: row.badge_name,
  rarity: row.rarity || 'COMMON',
  xpValue: Number(row.xp_value || 0),
  awardedAt: row.claimed_at,
  payload: {
    badgeName: row.badge_name,
    rarity: row.rarity || 'COMMON',
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
  
  const response = await callLocalBadgeApi({
    path: `/api/badges/user/${encodeURIComponent(normalizeAddress(address))}`,
  });

  if (!response.ok) {
    devLog('fetchUserBadges failed', response.data?.error);
    return { ok: false, awards: [] };
  }

  const rows = Array.isArray(response.data?.awards) ? response.data.awards : [];

  const awards = rows.map((row) => {
    // Map normalized backend row to frontend award object
    if (row?.badge_id) {
      return mapBadgeRowToAward({
        ...row,
        badge_name: row?.badge_definitions?.name || row?.badge_name,
        rarity: row?.rarity || 'COMMON',
        xp_value: row?.badge_definitions?.xp_value ?? row?.xp_value,
        claimed_at: row?.awarded_at || row?.verified_at,
      });
    }
    return row;
  });

  return {
    ok: true,
    awards,
  };
};

export const fetchAllBadges = async ({ includePrivate = false } = {}) => {
  const response = await callLocalBadgeApi({
    path: '/api/badges/definitions',
  });

  if (!response.ok) {
    devLog('[badges] fetchAllBadges failed:', response.data?.error);
    return { ok: false, badges: [] };
  }

  const remoteBadges = Array.isArray(response.data?.badges) ? response.data.badges : [];
  const badges = remoteBadges.map(mapBadgeDefinitionRow);
  const resolvedBadges = includePrivate ? badges : badges.filter((badge) => badge.isPublic !== false);

  return {
    ok: true,
    badges: resolvedBadges,
  };
};

export const saveBadgeDefinitions = async ({ badges, adminAuth, clearAwards = false }) => {
  const hasStaticHeaders = adminAuth && typeof adminAuth === 'object' && Object.keys(adminAuth).length > 0;
  const hasHeaderFactory = typeof adminAuth === 'function';
  if (!hasStaticHeaders && !hasHeaderFactory) {
    return {
      ok: false,
      status: 401,
      data: { error: 'Admin wallet approval is required' },
    };
  }

  const normalizedBadges = Array.isArray(badges) ? badges.map(mapBadgeDefinitionToRow).filter((badge) => badge.badge_id) : [];
  
  if (normalizedBadges.length === 0 && !clearAwards) {
    return { ok: true, status: 200, data: { count: 0 } };
  }

  const body = { action: 'batch_sync', badges: normalizedBadges };
  let headers;
  try {
    headers = await resolveAdminHeaders(adminAuth, body);
  } catch (error) {
    return {
      ok: false,
      status: 401,
      data: { error: String(error?.message || 'Admin wallet approval is required') },
    };
  }

  const result = await invokeAdminFunction('/api/admin/manage-badge', body, headers);
  if (!result.ok) return result;

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
  const walletAddress = normalizeAddress(wallet_address);
  const badgeId = String(badge_id ?? '').trim();

  if (!walletAddress || !badgeId) {
    return {
      data: null,
      error: { message: 'wallet_address and badge_id are required' },
    };
  }

  const response = await callLocalBadgeApi({
    path: `/api/badges/eligibility?wallet=${encodeURIComponent(walletAddress)}&badgeId=${encodeURIComponent(badgeId)}`,
  });

  if (!response.ok) {
    return {
      data: null,
      error: {
        message: response.data?.error || response.data?.reason || 'Failed to verify badge eligibility',
        status: response.status,
      },
    };
  }

  const data = response.data || {};
  return {
    data: {
      eligible: Boolean(data.eligible),
      status: data.eligible ? 'eligible' : 'not_eligible',
      reason: data.reason || null,
      progress: data.progress || null,
      cached: Boolean(data.cached || data.fromCache),
      proofHash: data.proofHash || data.proof_hash || null,
    },
    error: null,
  };
};

export const awardBadge = async (wallet_address, badge_id, adminAuth = null, signatureProof = null) => {
  const body = {
    walletAddress: normalizeAddress(wallet_address),
    badgeId: badge_id,
    signedMessage: String(signatureProof?.signedMessage || ''),
    signature: signatureProof?.signature || null,
    nonce: signatureProof?.nonce,
  };

  const headers = adminAuth && typeof adminAuth === 'object' ? adminAuth : {};

  const response = await callLocalBadgeApi({
    path: '/api/badges/award',
    method: 'POST',
    body,
    headers,
  });

  return { data: response.data, error: response.ok ? null : new Error(response.data?.error || 'Award failed') };
};

export const manageBadgeDefinition = async (action, badge, adminAuth = null) => {
  const body = { action, badge };
  const headers = adminAuth && typeof adminAuth === 'object' ? adminAuth : {};
  const response = await callLocalBadgeApi({
    path: '/api/admin/manage-badge',
    method: 'POST',
    body,
    headers,
  });
  return { data: response.data, error: response.ok ? null : new Error(response.data?.error || 'Management failed') };
};

export const importAllowlist = async (badgeId, addresses, adminAuth = null) => {
  const body = { badge_id: badgeId, addresses, action: 'import' };
  const headers = adminAuth && typeof adminAuth === 'object' ? adminAuth : {};
  const response = await callLocalBadgeApi({ path: '/api/admin/import-allowlist', method: 'POST', body, headers });
  return { ok: response.ok, data: response.data, status: response.status };
};

export const getAllowlistStats = async (badgeId, adminAuth = null) => {
  const body = { badge_id: badgeId, action: 'stats' };
  const headers = adminAuth && typeof adminAuth === 'object' ? adminAuth : {};
  const response = await callLocalBadgeApi({ path: '/api/admin/import-allowlist', method: 'POST', body, headers });
  return { ok: response.ok, data: response.data };
};

export const searchAllowlist = async (badgeId, walletAddress, adminAuth = null) => {
  const body = { badge_id: badgeId, wallet_address: walletAddress, action: 'search' };
  const headers = adminAuth && typeof adminAuth === 'object' ? adminAuth : {};
  const response = await callLocalBadgeApi({ path: '/api/admin/import-allowlist', method: 'POST', body, headers });
  return { ok: response.ok, data: response.data };
};

export const removeFromAllowlist = async (badgeId, walletAddress, adminAuth = null) => {
  const body = { badge_id: badgeId, wallet_address: walletAddress, action: 'remove' };
  const headers = adminAuth && typeof adminAuth === 'object' ? adminAuth : {};
  const response = await callLocalBadgeApi({ path: '/api/admin/import-allowlist', method: 'POST', body, headers });
  return { ok: response.ok, data: response.data };
};

export const clearAllowlist = async (badgeId, adminAuth = null) => {
  const body = { badge_id: badgeId, action: 'clear' };
  const headers = adminAuth && typeof adminAuth === 'object' ? adminAuth : {};
  const response = await callLocalBadgeApi({ path: '/api/admin/import-allowlist', method: 'POST', body, headers });
  return { ok: response.ok, data: response.data };
};

export const getUserBadges = async (wallet_address) => {
  if (!supabase) return [];
  const { data } = await supabase
    .from('badge_attestations')
    .select('*, badge_definitions(*)')
    .eq('wallet_address', normalizeAddress(wallet_address))
    .eq('eligible', true);

  return Array.isArray(data) ? data : [];
};

export const fetchBadgeHolders = async (badgeId) => {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('badge_attestations')
    .select('wallet_address, created_at')
    .eq('badge_id', badgeId)
    .eq('eligible', true);
  
  return { ok: !error, data: data || [], error: error?.message };
};

export const awardBadgeToUser = async (address, badgeId, payload = {}, options = {}) => {
  const walletAddress = normalizeAddress(address);
  const normalizedBadgeId = String(badgeId ?? '').trim();
  const signedMessage = String(options?.signedMessage || payload?.signedMessage || '').trim();
  const signature = options?.signature || payload?.signature || null;

  if (!walletAddress || !normalizedBadgeId) {
    return {
      ok: false,
      status: 400,
      data: { error: 'address and badgeId are required' },
    };
  }

  const response = await callLocalBadgeApi({
    path: '/api/badges/award',
    method: 'POST',
    body: {
      walletAddress,
      badgeId: normalizedBadgeId,
      signedMessage,
      signature,
      metadata: payload
    }
  });

  if (!response.ok) return response;

  return {
    ok: true,
    status: response.status,
    data: {
      badgeId: normalizedBadgeId,
      awardedAt: response.data?.awardedAt || new Date().toISOString(),
      payload,
      txHash: payload?.txHash || null,
    },
  };
};

export const fetchLeaderboard = async (limit = 100) => {
  const response = await callLocalBadgeApi({
    path: `/api/leaderboard?limit=${limit}`,
  });

  if (!response.ok) {
    return { ok: false, leaderboard: [], error: response.data?.error };
  }

  return {
    ok: true,
    leaderboard: Array.isArray(response.data?.leaderboard) ? response.data.leaderboard : [],
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

export const requestMintSignature = async (walletAddress, onChainBadgeId) => {
  const response = await callLocalBadgeApi({
    path: '/api/badges/award',
    method: 'POST',
    body: { walletAddress, onChainBadgeId },
  });

  if (!response.ok) {
    return {
      ok: false,
      error: response.data?.error || 'Failed to obtain mint signature',
    };
  }

  const data = response.data;
  const signatureBytes = data?.signatureBytes;
  if (!Array.isArray(signatureBytes) || signatureBytes.length !== 64) {
    return { ok: false, error: 'Invalid signature returned from server' };
  }

  const validUntil = data?.validUntil;
  if (typeof validUntil !== 'number' || validUntil <= 0) {
    return { ok: false, error: 'Missing expiry timestamp in server response' };
  }

  return { ok: true, signatureBytes, validUntil };
};

export const fetchUserProfile = async (address) => {
  const walletAddress = normalizeAddress(address);
  if (!walletAddress) {
    return { ok: false, profile: null, error: 'address is required' };
  }
  if (!supabase) return { ok: false, profile: null, error: 'Supabase not configured' };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, wallet_address, username, avatar_url, xp, created_at')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (error) {
    devLog('fetchUserProfile failed', error);
    return { ok: false, profile: null, error: error.message || 'Failed to fetch profile' };
  }

  return {
    ok: true,
    profile: data ? mapProfileRow(data) : null,
  };
};

export const updateUserProfile = async (address, { username, avatarUrl, bio, twitter, telegram, signatureProof } = {}) => {
  const walletAddress = normalizeAddress(address);
  if (!walletAddress) {
    return { ok: false, profile: null, error: 'address is required' };
  }

  // Production Hardening: Route through secure server API
  const body = {
    address: walletAddress,
    username,
    avatarUrl,
    bio,
    twitter,
    telegram,
    signature: signatureProof?.signature,
    signedMessage: signatureProof?.signedMessage,
    nonce: signatureProof?.nonce
  };

  const response = await callLocalBadgeApi({
    path: '/api/profiles',
    method: 'POST',
    body
  });

  if (!response.ok) {
    devLog('updateUserProfile failed', response.data?.error);
    return { ok: false, profile: null, error: response.data?.error || 'Failed to update profile' };
  }

  return {
    ok: true,
    profile: mapProfileRow(response.data),
  };
};

export const searchProfiles = async (query, maxResults = 10) => {
  const term = String(query || '').trim();
  if (!term) return { ok: true, profiles: [] };
  if (!supabase) return { ok: true, profiles: [] };

  const limit = Math.min(Math.max(Number(maxResults) || 10, 1), 10);
  const walletTerm = normalizeAddress(term);

  const selectFields = 'id, wallet_address, username, avatar_url, xp, created_at';

  const [walletResult, usernameResult] = await Promise.all([
    supabase
      .from('profiles')
      .select(selectFields)
      .like('wallet_address', `${walletTerm}%`) // Performance: prefix match uses GIN/Btree indexes better
      .limit(limit),
    supabase
      .from('profiles')
      .select(selectFields)
      .like('username', `${term}%`)
      .limit(limit),
  ]);

  if (walletResult.error && usernameResult.error) {
    devLog('searchProfiles failed', walletResult.error, usernameResult.error);
    return { ok: false, profiles: [] };
  }

  if (walletResult.error) {
    devLog('searchProfiles wallet query failed', walletResult.error);
  }
  if (usernameResult.error) {
    devLog('searchProfiles username query failed', usernameResult.error);
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
  importAllowlist,
};
