import { normalizeAddress } from '../utils/address.ts';
import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Global Database-Backed Rate Limiter
 */
export const checkRateLimit = async (
  supabaseAdmin: SupabaseClient | null,
  key: string,
  windowMs: number,
  maxRequests: number
): Promise<{ ok: boolean; count?: number; resetAt?: string; error?: string }> => {
  if (!supabaseAdmin) return { ok: true };

  try {
    const { data, error } = await supabaseAdmin.rpc('increment_api_rate_limit', {
      p_key: key,
      p_window_start: new Date().toISOString(),
      p_window_ms: windowMs
    });

    if (error) {
      console.error('[RateLimit] DB error:', error);
      return { ok: false, error: 'Rate limit service error' };
    }

    const currentCount = (data as any)?.[0]?.count || 1;
    return {
      ok: currentCount <= maxRequests,
      count: currentCount,
      resetAt: (data as any)?.[0]?.reset_at
    };
  } catch (err: any) {
    console.error('[RateLimit] Critical error:', err.message);
    return { ok: false, error: 'Rate limit service failure' };
  }
};

/**
 * Replay Protection: Check and burn nonce
 */
export const checkAndBurnNonce = async (
  supabaseAdmin: SupabaseClient | null,
  address: string,
  nonce: string | number,
  ttlMinutes: number = 5
): Promise<{ ok: boolean; error?: string }> => {
  if (!supabaseAdmin) return { ok: true };

  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  try {
    const { error } = await supabaseAdmin
      .from('used_nonces')
      .insert({
        wallet_address: normalizeAddress(address),
        nonce: String(nonce),
        expires_at: expiresAt
      });

    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: 'Nonce already used (Replay Attack detected)' };
      }
      console.error('[Nonce] DB error:', error.message);
      return { ok: false, error: 'Nonce verification error' };
    }

    return { ok: true };
  } catch (err: any) {
    console.error('[Nonce] Critical error:', err.message);
    return { ok: false, error: 'Nonce service failure' };
  }
};

/**
 * Gets the next available nonce for a wallet.
 * Uses a simple count of used nonces for that address.
 */
export const getNextNonce = async (
  supabaseAdmin: SupabaseClient | null,
  address: string
): Promise<number> => {
  if (!supabaseAdmin) return Date.now(); // Fallback to timestamp if DB is down

  const { count, error } = await supabaseAdmin
    .from('used_nonces')
    .select('*', { count: 'exact', head: true })
    .eq('wallet_address', normalizeAddress(address));

  if (error) {
    console.error('[Nonce] Fetch error:', error.message);
    return Date.now();
  }

  return (count || 0) + 1;
};

/**
 * Sybil Resistance: Check wallet activity on Movement
 */
export const checkMovementActivity = async (
  address: string,
  minTransactions: number = 5
): Promise<{ ok: boolean; count?: number; error?: string }> => {
  const normalized = normalizeAddress(address);
  const rpcUrl = process.env.MOVEMENT_RPC_URL || 'https://testnet.movementnetwork.xyz/v1';

  try {
    const response = await fetch(`${rpcUrl}/accounts/${normalized}`);
    if (!response.ok) {
      if (response.status === 404) return { ok: false, error: 'Wallet has no on-chain history (Sybil protection)' };
      throw new Error(`RPC status ${response.status}`);
    }

    const accountData: any = await response.json();
    const sequenceNumber = Number(accountData?.sequence_number || 0);

    return {
      ok: sequenceNumber >= minTransactions,
      count: sequenceNumber
    };
  } catch (err: any) {
    console.error('[Sybil] RPC check failed:', err.message);
    return { ok: true };
  }
};

