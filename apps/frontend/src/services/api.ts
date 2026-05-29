/// <reference types="vite/client" />
import { BadgeDefinition, Profile, EligibilityResult, LeaderboardEntry } from '@daftar/types';
import { normalizeAddress } from '../utils/address';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

const callApi = async <T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> => {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : (data?.error || 'Unknown error'),
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error.message || 'Network error',
    };
  }
};

export const getProfile = async (address: string): Promise<Profile | null> => {
  const normalized = normalizeAddress(address);
  const response = await callApi<Profile>(`/api/profiles/${encodeURIComponent(normalized)}`);
  return response.ok ? response.data : null;
};

export const updateProfile = async (
  address: string,
  profile: Partial<Profile>,
  signature?: any,
  signedMessage?: string,
  nonce?: number
): Promise<Profile> => {
  const response = await callApi<Profile>(`/api/profiles`, {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: normalizeAddress(address),
      username: profile.username,
      bio: profile.bio,
      twitter: profile.twitter,
      telegram: profile.telegram,
      avatarUrl: profile.avatar_url,
      signature,
      signedMessage,
      nonce
    }),
  });

  if (!response.ok || !response.data) {
    throw new Error(response.error || 'Failed to update profile');
  }

  return response.data;
};

export const getNonce = async (address: string): Promise<number | null> => {
  const response = await callApi<{ nonce: number }>(`/api/profiles/nonce?address=${encodeURIComponent(normalizeAddress(address))}`);
  return response.ok ? response.data?.nonce ?? null : null;
};

export const getBadges = async (): Promise<BadgeDefinition[]> => {
  const response = await callApi<BadgeDefinition[]>('/api/badges');
  return response.ok ? (response.data || []) : [];
};

export const checkBadgeEligibility = async (badgeId: string, wallet: string, force: boolean = false): Promise<EligibilityResult | null> => {
  const forceParam = force ? '&force=true' : '';
  const response = await callApi<EligibilityResult>(
    `/api/badges/eligibility?wallet=${encodeURIComponent(normalizeAddress(wallet))}&badgeId=${encodeURIComponent(badgeId)}${forceParam}`
  );
  return response.ok ? response.data : null;
};

export const awardBadge = async (walletAddress: string, badgeId: string, signature?: string): Promise<any> => {
  const response = await callApi('/api/badges/award', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: normalizeAddress(walletAddress),
      badgeId,
      signature
    }),
  });

  if (!response.ok) {
    throw new Error(response.error || 'Award failed');
  }

  return response.data;
};

export const getLeaderboard = async (limit: number = 100): Promise<LeaderboardEntry[]> => {
  const response = await callApi<{ leaderboard: LeaderboardEntry[] }>(`/api/leaderboard?limit=${limit}`);
  return response.ok ? (response.data?.leaderboard || []) : [];
};

export const searchProfiles = async (query: string, limit: number = 10): Promise<Profile[]> => {
  const response = await callApi<Profile[]>(
    `/api/profiles?query=${encodeURIComponent(query)}&limit=${limit}`
  );
  return response.ok ? (response.data || []) : [];
};

export const fetchUserBadges = async (address: string) => {
  const normalized = normalizeAddress(address);
  const response = await callApi<{ awards: any[] }>(`/api/badges/user/${encodeURIComponent(normalized)}`);
  return { ok: response.ok, awards: response.data?.awards || [], status: response.status, data: response.data };
};

export const fetchAllBadges = async (options: { includePrivate?: boolean, includeInactive?: boolean } = {}) => {
  const query = new URLSearchParams();
  if (options.includePrivate) query.append('includePrivate', 'true');
  if (options.includeInactive) query.append('includeInactive', 'true');

  const path = `/api/badges${query.toString() ? `?${query.toString()}` : ''}`;
  const response = await callApi<BadgeDefinition[]>(path);
  return {
    ok: response.ok,
    badges: response.data || [],
    status: response.status,
    data: response.data,
    error: response.error
  };
};

export const saveBadgeDefinitions = async (payload: { badges: any[], adminAuth: any, clearAwards?: boolean }) => {
  const response = await callApi<{ badges: BadgeDefinition[] }>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action: 'batch_sync', ...payload }),
    headers: payload.adminAuth || {}
  });
  return response;
};

export const manageBadgeDefinition = async (action: string, badge: any, adminAuth: any) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action, badge }),
    headers: adminAuth || {}
  });
  return response;
};

export const awardBadgeToUser = async (address: string, badgeId: string, metadata: any, options: { adminAuth: any }) => {
  const response = await callApi<any>('/api/badges/award', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: normalizeAddress(address),
      badgeId,
      metadata,
      ...options
    }),
    headers: options?.adminAuth || {}
  });
  return response;
};

export const requestMintSignature = async (walletAddress: string, badgeId: string | number) => {
  const response = await callApi<{ 
    signatureBytes: number[], 
    validUntil: number,
    signerEpoch: number,
    nonce: number
  }>('/api/badges/award', {
    method: 'POST',
    body: JSON.stringify({ walletAddress, badgeId }),
  });

  if (!response.ok) {
    return {
      ok: false,
      error: response.error || 'Failed to obtain mint signature',
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

  return { 
    ok: true, 
    signatureBytes, 
    validUntil,
    signerEpoch: data?.signerEpoch || 0,
    nonce: data?.nonce || 0
  };
};

export const importAllowlist = async (badgeId: string, addresses: string[], adminAuth: any) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action: 'import-allowlist', badge_id: badgeId, addresses, action_type: 'import' }),
    headers: adminAuth || {}
  });
  return response;
};

export const getAllowlistStats = async (badgeId: string, adminAuth: any) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action: 'import-allowlist', badge_id: badgeId, action_type: 'stats' }),
    headers: adminAuth || {}
  });
  return response;
};

export const searchAllowlist = async (badgeId: string, walletAddress: string, adminAuth: any) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action: 'import-allowlist', badge_id: badgeId, wallet_address: walletAddress, action_type: 'search' }),
    headers: adminAuth || {}
  });
  return response;
};

export const removeFromAllowlist = async (badgeId: string, walletAddress: string, adminAuth: any) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action: 'import-allowlist', badge_id: badgeId, wallet_address: walletAddress, action_type: 'remove' }),
    headers: adminAuth || {}
  });
  return response;
};

export const clearAllowlist = async (badgeId: string, adminAuth: any) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action: 'import-allowlist', badge_id: badgeId, action_type: 'clear' }),
    headers: adminAuth || {}
  });
  return response;
};

export const fetchBadgeHolders = async (badgeId: string) => {
  const response = await callApi<{ holders: any[] }>(`/api/badges/holders/${encodeURIComponent(badgeId)}`);
  return { ok: response.ok, data: response.data?.holders || [], status: response.status, error: response.error };
};

export const fetchAdminBadges = async (adminAuth: any, includeDeleted: boolean = false) => {
  const response = await callApi<{ badges: BadgeDefinition[] }>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action: 'list-all-badges', include_deleted: includeDeleted }),
    headers: adminAuth || {}
  });
  return { ok: response.ok, badges: response.data?.badges || [], status: response.status, error: response.error };
};

export const getSystemConfig = async (): Promise<Record<string, any>> => {
  const response = await callApi<Record<string, any>>('/api/config');
  return response.ok ? (response.data || {}) : {};
};

export const updateSystemConfig = async (settings: Record<string, any>, adminAuth: any) => {
  const response = await callApi<any>('/api/config', {
    method: 'POST',
    body: JSON.stringify({ settings }),
    headers: adminAuth || {}
  });
  return response;
};

export const manageEntity = async (action_type: 'POST' | 'DELETE', payload: any, adminAuth: any) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ 
      action: 'manage-entities', 
      method: action_type,
      entity: action_type === 'POST' ? payload : undefined,
      id: action_type === 'DELETE' ? payload.id : undefined
    }),
    headers: adminAuth || {}
  });
  return response;
};

export const manageUserVerification = async (action_data: { method: 'LIST' | 'TOGGLE_VERIFICATION', address?: string, verified?: boolean, query?: string }, adminAuth: any) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ 
      action: 'manage-users', 
      ...action_data
    }),
    headers: adminAuth || {}
  });
  return response;
};

export const manageSubscription = async (
  action_data: {
    method: 'LIST' | 'SET_TIER';
    address?: string;
    tier?: 'free' | 'lite' | 'pro';
    expires_at?: string | null;
    query?: string;
    tierFilter?: string;
  },
  adminAuth: any
) => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({
      action: 'manage-subscriptions',
      ...action_data
    }),
    headers: adminAuth || {}
  });
  return response;
};

export const getSubscriptionStatus = async (walletAddress: string): Promise<any> => {
  const response = await callApi<any>(`/api/subscription/status?wallet=${encodeURIComponent(normalizeAddress(walletAddress))}`);
  return response.ok ? response.data : null;
};

export const getSubscriptionPlans = async (): Promise<any> => {
  const response = await callApi<any>('/api/subscription/plans');
  return response.ok ? response.data?.plans : [];
};

export const getNFTCollectionStats = async (): Promise<Record<string, { floor: number; topBid: number }>> => {
  const response = await callApi<{ collections: any[] }>('/api/prices/nft');
  if (!response.ok || !response.data?.collections) return {};

  const statsMap: Record<string, { floor: number; topBid: number }> = {};
  response.data.collections.forEach((col: any) => {
    statsMap[col.collection_id] = {
      floor: Number(col.floor_price || 0),
      topBid: Number(col.top_bid || 0)
    };
  });
  return statsMap;
};

export default {
  getProfile,
  getNFTCollectionStats,
  updateProfile,
  getNonce,
  getBadges,
  checkBadgeEligibility,
  awardBadge,
  getLeaderboard,
  searchProfiles,
  fetchUserBadges,
  fetchAllBadges,
  saveBadgeDefinitions,
  manageBadgeDefinition,
  awardBadgeToUser,
  requestMintSignature,
  importAllowlist,
  getAllowlistStats,
  searchAllowlist,
  removeFromAllowlist,
  clearAllowlist,
  fetchBadgeHolders,
  fetchAdminBadges,
  getSystemConfig,
  updateSystemConfig,
  manageEntity,
  manageUserVerification,
  manageSubscription,
  getSubscriptionStatus,
  getSubscriptionPlans
};
