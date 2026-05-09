import { BADGE_RULES, normalizeRuleType } from './validationService.ts';
import fetch from 'node-fetch';
import { normalizeAddress } from '../utils/address.ts';
import CONFIG from '../config/index.ts';
import { SupabaseClient } from '@supabase/supabase-js';
import { BadgeDefinition, EligibilityResult } from '@daftar/types';

const VERIFIED_CACHE_TTL_MS = CONFIG.CACHE.VERIFIED_TTL_MS;

// Short-lived cache for on-chain data to deduplicate burst requests (e.g. bulk scan)
const RPC_BURST_CACHE = new Map<string, { value: any; timestamp: number }>();
const RPC_BURST_TTL_MS = 10_000; // 10 seconds

const getCachedRpc = (key: string) => {
  const cached = RPC_BURST_CACHE.get(key);
  if (cached && Date.now() - cached.timestamp < RPC_BURST_TTL_MS) return cached.value;
  return null;
};

const setCachedRpc = (key: string, value: any) => {
  RPC_BURST_CACHE.set(key, { value, timestamp: Date.now() });
};

export const isFresh = (timestamp: string | null | undefined): boolean => {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && Date.now() - parsed <= VERIFIED_CACHE_TTL_MS;
};

export const getFullnodeUrl = (): string => {
  return CONFIG.MOVEMENT.RPC_URL.replace(/\/$/, '');
};

const fetchJson = async (url: string, init?: any): Promise<{ response: any; parsed: any }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (err) {
      console.error(`Failed to parse JSON from ${url}:`, err);
    }
    return { response, parsed };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Handlers for different badge rules
 */
const HANDLERS: Record<number, (supabase: SupabaseClient, wallet: string, badge: BadgeDefinition, params: any) => Promise<EligibilityResult>> = {
  [BADGE_RULES.ALLOWLIST]: async (supabase, wallet, badge) => {
    const { data: isEligible } = await supabase
      .from('badge_eligible_wallets')
      .select('wallet_address')
      .eq('badge_id', badge.badge_id)
      .eq('wallet_address', wallet)
      .maybeSingle();
    return {
      eligible: !!isEligible,
      reason: isEligible ? 'allowlist-verified' : 'not-in-allowlist'
    };
  },

  [BADGE_RULES.MIN_BALANCE]: async (supabase, wallet, badge, params) => {
    const coinType = String(params.coin_type ?? params.coinType ?? '').trim();
    if (!coinType) throw new Error('MIN_BALANCE requires coin_type');
    
    const cacheKey = `bal:${wallet}:${coinType}`;
    let rawBalance = getCachedRpc(cacheKey);

    if (rawBalance === null) {
      const fullnodeUrl = getFullnodeUrl();
      const { response, parsed } = await fetchJson(`${fullnodeUrl}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          function: '0x1::coin::balance',
          type_arguments: [coinType],
          arguments: [wallet],
        }),
      });

      if (!Array.isArray(parsed)) {
        throw new Error(parsed?.message || 'Invalid RPC response format');
      }

      rawBalance = Number(parsed[0] ?? 0);
      setCachedRpc(cacheKey, rawBalance);
    }
    const rawBalanceVal = BigInt(rawBalance || 0);
    const decimals = Number(params.decimals ?? 8);
    const minAmount = Number(params.min_amount ?? params.minAmount ?? params.min ?? 0);
    const minAmountRaw = BigInt(Math.floor(minAmount * Math.pow(10, decimals)));

    const isEligible = rawBalanceVal >= minAmountRaw;
    const currentDisplay = Number(rawBalanceVal) / Math.pow(10, decimals);

    return {
      eligible: isEligible,
      reason: isEligible ? 'min-balance-threshold-met' : 'min-balance-threshold-not-met',
      progress: { current: currentDisplay, target: minAmount }
    };
  },

  [BADGE_RULES.TX_COUNT]: async (supabase, wallet, badge, params) => {
    const minCount = Math.max(1, Number(params.min_count ?? params.minAmount ?? params.count ?? params.min ?? 1));
    const { count } = await supabase
      .from('transaction_history')
      .select('*', { count: 'exact', head: true })
      .eq('wallet_address', wallet);
    
    const current = count || 0;
    return {
      eligible: current >= minCount,
      reason: current >= minCount ? 'transaction-threshold-met' : 'transaction-threshold-not-met',
      progress: { current, target: minCount }
    };
  },

  [BADGE_RULES.ACTIVE_DAYS]: async (supabase, wallet, badge, params) => {
    const minDays = Math.max(1, Number(params.min_days ?? params.minDays ?? params.days ?? params.min ?? 1));
    const { data } = await supabase.rpc('count_active_days', { user_addr: wallet });
    const current = Number(data || 0);
    return {
      eligible: current >= minDays,
      reason: current >= minDays ? 'active-days-threshold-met' : 'active-days-threshold-not-met',
      progress: { current, target: minDays }
    };
  },

  [BADGE_RULES.DAFTAR_PROFILE_COMPLETE]: async (supabase, wallet) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, bio, avatar_url')
      .eq('wallet_address', wallet)
      .maybeSingle();

    const fields = [profile?.username, profile?.bio, profile?.avatar_url];
    const current = fields.filter(Boolean).length;
    const target = fields.length;
    const isComplete = current === target;

    return {
      eligible: isComplete,
      reason: isComplete ? 'profile-complete' : 'profile-incomplete',
      progress: { current, target }
    };
  },

  [BADGE_RULES.DAFTAR_SWAP_COUNT]: async (supabase, wallet, badge, params) => {
    const min = Math.max(1, Number(params.min ?? 1));
    const { data: stats } = await supabase
      .from('dapp_swap_stats')
      .select('total_swaps')
      .eq('wallet_address', wallet)
      .maybeSingle();

    const current = stats?.total_swaps || 0;
    return {
      eligible: current >= min,
      reason: current >= min ? 'swap-count-met' : 'swap-count-not-met',
      progress: { current, target: min }
    };
  },

  [BADGE_RULES.DAFTAR_VOLUME_USD]: async (supabase, wallet, badge, params) => {
    const min = Math.max(0, Number(params.min ?? 10));
    const { data: stats } = await supabase
      .from('dapp_swap_stats')
      .select('total_volume_usd')
      .eq('wallet_address', wallet)
      .maybeSingle();

    const current = Number(stats?.total_volume_usd || 0);
    return {
      eligible: current >= min,
      reason: current >= min ? 'volume-threshold-met' : 'volume-threshold-not-met',
      progress: { current, target: min }
    };
  },

  [BADGE_RULES.ANYONE]: async () => {
    return {
      eligible: true,
      reason: 'open-badge-accessible-to-all'
    };
  }
};

/**
 * Fetches the current signer epoch from the badges smart contract.
 */
export const getSignerEpoch = async (): Promise<number> => {
  const fullnodeUrl = getFullnodeUrl();
  const moduleAddr = CONFIG.SIGNER.MODULE_ADDRESS;
  if (!moduleAddr) return 0;

  try {
    const { parsed } = await fetchJson(`${fullnodeUrl}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function: `${moduleAddr}::badges::get_signer_epoch`,
        type_arguments: [],
        arguments: [],
      }),
    });

    if (Array.isArray(parsed) && parsed.length > 0) {
      return Number(parsed[0]);
    }
  } catch (err) {
    console.error('[Evaluation] Failed to fetch signer epoch:', err);
  }
  return 0;
};

/**
 * Verifies that a transaction hash actually represents a valid mint for a specific badge and user.
 */
export const verifyOnChainMint = async (
  txHash: string,
  walletAddress: string,
  onChainBadgeId: number
): Promise<boolean> => {
  if (!txHash || !txHash.startsWith('0x')) return false;

  const fullnodeUrl = getFullnodeUrl();
  const moduleAddr = CONFIG.SIGNER.MODULE_ADDRESS;

  try {
    const { response, parsed } = await fetchJson(`${fullnodeUrl}/transactions/by_hash/${txHash}`);
    if (!response.ok || !parsed) return false;

    // Check if transaction was successful
    if (parsed.success !== true) return false;

    // Search through events for BadgeMinted
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    const mintEvent = events.find((e: any) => 
      e.type === `${moduleAddr}::badges::BadgeMinted` &&
      normalizeAddress(e.data?.recipient) === normalizeAddress(walletAddress) &&
      Number(e.data?.badge_id) === Number(onChainBadgeId)
    );

    return !!mintEvent;
  } catch (err) {
    console.error('[Evaluation] On-chain verification failed:', err);
    return false;
  }
};

export const evaluateRule = async (
  supabase: SupabaseClient,
  walletAddress: string,
  badge: BadgeDefinition,
  cachedAttestation: any
): Promise<EligibilityResult> => {
  // 1. Time-Gate Check
  const now = Date.now();
  const special = badge.metadata?.special;
  if (special?.timeLimited?.enabled) {
    const start = special.timeLimited.startsAt ? new Date(special.timeLimited.startsAt).getTime() : 0;
    const end = special.timeLimited.endsAt ? new Date(special.timeLimited.endsAt).getTime() : Infinity;

    if (now < start) {
      return { eligible: false, reason: 'badge-event-not-started' };
    }
    if (now > end) {
      return { eligible: false, reason: 'badge-event-expired' };
    }
  }

  // 2. Cache Check
  if (cachedAttestation?.eligible === true && isFresh(cachedAttestation.verified_at)) {
    return { eligible: true, reason: 'cached', fromCache: true };
  }

  // 2. Composite Criteria Support
  const criteria = Array.isArray(badge.criteria) ? badge.criteria : [];
  if (criteria.length > 0) {
    const operator = (badge.rule_params?.operator || 'AND').toUpperCase();
    
    const results = await Promise.all(criteria.map(async (c) => {
      const mockBadge: BadgeDefinition = { 
        ...badge, 
        criteria: [], 
        rule_type: c.rule_type || c.type || 0, 
        rule_params: c.params || {} 
      };
      return await evaluateRule(supabase, walletAddress, mockBadge, null);
    }));

    const isEligible = operator === 'OR' 
      ? results.some(r => r.eligible) 
      : results.every(r => r.eligible);

    return {
      eligible: isEligible,
      reason: isEligible 
        ? (operator === 'OR' ? 'at-least-one-criterion-met' : 'all-criteria-met') 
        : (operator === 'OR' ? 'no-criteria-met' : (results.find(r => !r.eligible)?.reason || 'criteria-not-met')),
      fromCache: false
    };
  }

  // 3. Single Rule Evaluation
  const ruleType = normalizeRuleType(badge.rule_type);
  if (ruleType === null) return { eligible: false, reason: 'invalid-rule-type' };
  
  const handler = HANDLERS[ruleType];

  if (!handler) {
    return {
      eligible: cachedAttestation?.eligible === true,
      reason: 'manual-verification-required',
      fromCache: !!cachedAttestation?.eligible
    };
  }

  try {
    const result = await handler(supabase, walletAddress, badge, badge.rule_params || {});
    return { ...result, fromCache: false };
  } catch (err: any) {
    console.error(`[Evaluation] Rule ${ruleType} failed:`, err.message);
    return { eligible: false, reason: 'evaluation-error', error: err.message };
  }
};

