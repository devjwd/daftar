/// <reference types="vite/client" />
import { BadgeDefinition, Profile, EligibilityResult, LeaderboardEntry } from '@daftar/shared-types';
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

export const managePlan = async (
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

export const getPlanStatus = async (walletAddress: string): Promise<any> => {
  const response = await callApi<any>(`/api/plans/status?wallet=${encodeURIComponent(normalizeAddress(walletAddress))}`);
  return response.ok ? response.data : null;
};

export const getPlanList = async (): Promise<any> => {
  const response = await callApi<any>('/api/plans');
  return response.ok ? response.data?.plans : [];
};

export const getPlansConfig = async (): Promise<{
  basePriceUsd: number;
  discountPriceUsd: number | null;
  discountLabel: string;
  treasuryWallet: string;
  durationDays: number;
  movePriceUsd: number;
  discountScope: 'first_month' | 'all_months';
} | null> => {
  const response = await callApi<any>('/api/plans/config');
  return response.ok ? response.data : null;
};

export const verifySubscriptionPayment = async (
  walletAddress: string,
  txHash: string,
  months: number = 1
): Promise<{ ok: boolean; tier?: string; expiresAt?: string; error?: string }> => {
  const response = await callApi<any>('/api/plans/verify-payment', {
    method: 'POST',
    body: JSON.stringify({ walletAddress, txHash, months }),
  });
  if (response.ok) {
    return { ok: true, ...response.data };
  }
  return { ok: false, error: response.error || 'Verification failed' };
};

export const setSubscriptionPaymentConfig = async (
  config: {
    price_usd: number;
    discount_price_usd: string | number;
    discount_label: string;
    treasury_wallet: string;
    duration_days: number;
    discount_scope: 'first_month' | 'all_months';
  },
  adminAuth: any
): Promise<{ ok: boolean; error?: string }> => {
  const body = { method: 'SET_PAYMENT_CONFIG', ...config };
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({ action: 'manage-subscriptions', ...body }),
    headers: adminAuth || {},
  });
  return { ok: response.ok, error: response.error };
};

export const submitFeedback = async (payload: {
  feature: string;
  feedbackText: string;
  screenshot?: string;
  walletAddress?: string;
}): Promise<{ ok: boolean; error?: string }> => {
  const response = await callApi<any>('/api/feedback', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return {
    ok: response.ok,
    error: response.error,
  };
};

export const submitBugReport = async (payload: {
  type: string;
  description: string;
  screenshot?: string;
  walletAddress?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
}): Promise<{ ok: boolean; error?: string }> => {
  const response = await callApi<any>('/api/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return {
    ok: response.ok,
    error: response.error,
  };
};

export const manageReports = async (
  action_data: {
    method: 'LIST' | 'DELETE';
    id?: string;
  },
  adminAuth: any
): Promise<any> => {
  const response = await callApi<any>('/api/admin/manage-badge', {
    method: 'POST',
    body: JSON.stringify({
      action: 'manage-reports',
      ...action_data
    }),
    headers: adminAuth || {}
  });
  return response;
};

export const getAlertConfig = async (
  address: string,
  signature?: any,
  message?: string,
  nonce?: number
): Promise<any> => {
  const params: Record<string, string> = {
    address: normalizeAddress(address)
  };
  if (signature !== undefined) {
    params.signature = typeof signature === 'string' ? signature : JSON.stringify(signature);
  }
  if (message !== undefined) {
    params.message = message;
  }
  if (nonce !== undefined) {
    params.nonce = String(nonce);
  }
  const qs = new URLSearchParams(params);
  const response = await callApi<any>(`/api/alerts/config?${qs.toString()}`);
  return response.ok ? response.data : null;
};

export const saveAlertConfig = async (
  address: string,
  config: any,
  signature: any,
  signedMessage: string,
  nonce: number
): Promise<any> => {
  const response = await callApi<any>('/api/alerts/config', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizeAddress(address),
      ...config,
      signature,
      signedMessage,
      nonce
    })
  });
  if (!response.ok) {
    throw new Error(response.error || 'Failed to save alert configuration');
  }
  return response.data;
};

export const linkDiscord = async (
  address: string,
  discordUserId: string,
  signature: any,
  signedMessage: string,
  nonce: number
): Promise<any> => {
  const response = await callApi<any>('/api/alerts/link-discord', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizeAddress(address),
      discord_user_id: discordUserId,
      signature,
      signedMessage,
      nonce
    })
  });
  if (!response.ok) {
    throw new Error(response.error || 'Failed to link Discord account');
  }
  return response.data;
};

export const testAlerts = async (
  address: string,
  signature: any,
  signedMessage: string,
  nonce: number
): Promise<any> => {
  const response = await callApi<any>('/api/alerts/test', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizeAddress(address),
      signature,
      signedMessage,
      nonce
    })
  });
  if (!response.ok) {
    throw new Error(response.error || 'Failed to send test notification');
  }
  return response.data;
};

export const checkAlertLink = async (
  address: string
): Promise<{ telegramLinked: boolean; discordLinked: boolean; telegramEnabled: boolean; discordEnabled: boolean } | null> => {
  const response = await callApi<any>(`/api/alerts/check-link?address=${encodeURIComponent(normalizeAddress(address))}`);
  return response.ok ? response.data : null;
};

export const exchangeDiscordOauth = async (
  address: string,
  code: string,
  redirectUri: string,
  signature: any,
  signedMessage: string,
  nonce: number
): Promise<any> => {
  const response = await callApi<any>('/api/alerts/discord-oauth', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizeAddress(address),
      code,
      redirectUri,
      signature,
      signedMessage,
      nonce
    })
  });
  if (!response.ok) {
    throw new Error(response.error || 'Failed to authorize Discord account');
  }
  return response.data;
};

export const getTelegramLinkCode = async (
  address: string,
  signature: any,
  signedMessage: string,
  nonce: number
): Promise<{ code: string }> => {
  const response = await callApi<any>('/api/alerts/telegram-code', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizeAddress(address),
      signature,
      signedMessage,
      nonce
    })
  });
  if (!response.ok) {
    throw new Error(response.error || 'Failed to generate connection code');
  }
  return response.data;
};



