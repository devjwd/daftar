import { BADGE_RULES, normalizeRuleType } from './validationService.ts';
import fetch from 'node-fetch';
import { normalizeAddress } from '../utils/address.ts';
import CONFIG from '../config/index.ts';
import { SupabaseClient } from '@supabase/supabase-js';
import { BadgeDefinition, EligibilityResult } from '@daftar/types';

const VERIFIED_CACHE_TTL_MS = CONFIG.CACHE.VERIFIED_TTL_MS;

export const isFresh = (timestamp: string | null | undefined): boolean => {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && Date.now() - parsed <= VERIFIED_CACHE_TTL_MS;
};

export const getFullnodeUrl = (): string => {
  return CONFIG.MOVEMENT.RPC_URL.replace(/\/$/, '');
};

const fetchJson = async (url: string, init?: any): Promise<{ response: any; parsed: any }> => {
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (err) {
    console.error(`Failed to parse JSON from ${url}:`, err);
  }
  return { response, parsed };
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
    const coinType = String(params.coin_type ?? '').trim();
    if (!coinType) throw new Error('MIN_BALANCE requires coin_type');
    
    const fullnodeUrl = getFullnodeUrl();
    const view = await fetchJson(`${fullnodeUrl}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function: '0x1::coin::balance',
        type_arguments: [coinType],
        arguments: [wallet],
      }),
    });

    const rawBalance = Array.isArray(view.parsed) ? Number(view.parsed[0] ?? 0) : 0;
    const decimals = Number(params.decimals ?? 8);
    const balance = rawBalance / Math.pow(10, decimals);
    const minAmount = Number(params.min_amount ?? 0);

    return {
      eligible: balance >= minAmount,
      reason: balance >= minAmount ? 'min-balance-threshold-met' : 'min-balance-threshold-not-met'
    };
  },

  [BADGE_RULES.TX_COUNT]: async (supabase, wallet, badge, params) => {
    const minCount = Math.max(1, Number(params.min_count ?? 1));
    const { count } = await supabase
      .from('transaction_history')
      .select('*', { count: 'exact', head: true })
      .eq('wallet_address', wallet);
    
    const current = count || 0;
    return {
      eligible: current >= minCount,
      reason: current >= minCount ? 'transaction-threshold-met' : 'transaction-threshold-not-met'
    };
  }
};

export const evaluateRule = async (
  supabase: SupabaseClient,
  walletAddress: string,
  badge: BadgeDefinition,
  cachedAttestation: any
): Promise<EligibilityResult> => {
  // 1. Cache Check
  if (cachedAttestation?.eligible === true && isFresh(cachedAttestation.verified_at)) {
    return { eligible: true, reason: 'cached', fromCache: true };
  }

  // 2. Composite Criteria Support
  const criteria = Array.isArray(badge.criteria) ? badge.criteria : [];
  if (criteria.length > 0) {
    const results = await Promise.all(criteria.map(async (c) => {
      const mockBadge: BadgeDefinition = { 
        ...badge, 
        criteria: [], 
        rule_type: c.rule_type || 0, 
        rule_params: c.params || {} 
      };
      return await evaluateRule(supabase, walletAddress, mockBadge, null);
    }));
    const allEligible = results.every(r => r.eligible);
    return {
      eligible: allEligible,
      reason: allEligible ? 'all-criteria-met' : (results.find(r => !r.eligible)?.reason || 'criteria-not-met'),
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

