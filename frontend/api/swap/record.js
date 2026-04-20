import { createClient } from '@supabase/supabase-js';
import { handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METHODS = ['POST', 'OPTIONS'];
const ADDRESS_PATTERN = /^0x[a-f0-9]{1,64}$/i;
const TX_HASH_PATTERN = /^0x[a-f0-9]{64}$/i;
const RPC_VERIFY_TIMEOUT_MS = 10_000;
const MAX_BODY_SIZE = 2048;

const DAFTAR_DAPP = {
  dapp_key: 'daftar',
  dapp_name: 'Daftar',
  dapp_logo: '/daftar-logo.svg',
  dapp_website: 'https://daftar.fi',
};

const DEFAULT_RPC_URL = 'https://mainnet.movementnetwork.xyz/v1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizeWallet = (value) => String(value || '').trim().toLowerCase();

const isValidWallet = (value) => {
  const normalized = normalizeWallet(value);
  return ADDRESS_PATTERN.test(normalized) && normalized.length > 2;
};

const isValidTxHash = (value) => TX_HASH_PATTERN.test(String(value || '').trim());

const toSafeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const getRpcUrl = () => {
  const env = String(
    process.env.MOVEMENT_RPC_URL ||
    process.env.VITE_MOVEMENT_RPC_URL ||
    ''
  ).trim();
  return env || DEFAULT_RPC_URL;
};

const getSupabase = () => {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

// ---------------------------------------------------------------------------
// On-chain verification
// ---------------------------------------------------------------------------

/**
 * Verify that the transaction actually succeeded on-chain.
 * Returns true only if the RPC confirms `success === true`.
 */
const verifyTransactionOnChain = async (txHash) => {
  const rpcUrl = getRpcUrl();
  const url = `${rpcUrl}/transactions/by_hash/${txHash}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_VERIFY_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      console.error(`[swap/record] RPC verification failed: ${response.status}`);
      return { verified: false, error: `RPC returned ${response.status}` };
    }

    const data = await response.json();

    if (data.success !== true && data.success !== 'true') {
      return { verified: false, error: 'Transaction failed on-chain' };
    }

    return {
      verified: true,
      timestamp: data.timestamp || null,
      gasUsed: data.gas_used || null,
      gasUnitPrice: data.gas_unit_price || null,
      sender: data.sender || null,
    };
  } catch (err) {
    const message = err.name === 'AbortError'
      ? 'RPC verification timed out'
      : String(err.message || err);
    console.error('[swap/record] RPC verification error:', message);
    return { verified: false, error: message };
  }
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  try {
    // --- Parse & validate body ---
    const body = req.body || {};
    const rawJson = JSON.stringify(body);
    if (rawJson.length > MAX_BODY_SIZE) {
      return sendJson(res, 400, { error: 'Request body too large' });
    }

    const walletAddress = normalizeWallet(body.walletAddress);
    const txHash = String(body.txHash || '').trim();
    const tokenIn = String(body.tokenIn || '').trim() || null;
    const tokenOut = String(body.tokenOut || '').trim() || null;
    const amountIn = toSafeNumber(body.amountIn);
    const amountOut = toSafeNumber(body.amountOut);
    const amountInUsd = toSafeNumber(body.amountInUsd);
    const amountOutUsd = toSafeNumber(body.amountOutUsd);

    if (!isValidWallet(walletAddress)) {
      return sendJson(res, 400, { error: 'Invalid wallet address' });
    }

    if (!isValidTxHash(txHash)) {
      return sendJson(res, 400, { error: 'Invalid transaction hash' });
    }

    if (!tokenIn || !tokenOut) {
      return sendJson(res, 400, { error: 'tokenIn and tokenOut are required' });
    }

    // --- Verify on-chain ---
    const verification = await verifyTransactionOnChain(txHash);

    if (!verification.verified) {
      return sendJson(res, 422, {
        error: 'Transaction not verified on-chain',
        detail: verification.error,
      });
    }

    // Verify the sender matches the claimed wallet
    if (verification.sender) {
      const onChainSender = normalizeWallet(verification.sender);
      if (onChainSender !== walletAddress) {
        return sendJson(res, 403, {
          error: 'Transaction sender does not match wallet address',
        });
      }
    }

    // --- Supabase client ---
    const supabase = getSupabase();
    if (!supabase) {
      console.error('[swap/record] Supabase not configured');
      return sendJson(res, 500, { error: 'Server configuration error' });
    }

    // --- Calculate gas fee ---
    const gasUsed = toSafeNumber(verification.gasUsed);
    const gasUnitPrice = toSafeNumber(verification.gasUnitPrice);
    const gasFee = gasUsed > 0 && gasUnitPrice > 0
      ? (gasUsed * gasUnitPrice) / 1e8
      : 0;

    // --- Determine timestamp ---
    const txTimestamp = verification.timestamp
      ? new Date(Number(verification.timestamp) / 1000).toISOString()
      : new Date().toISOString();

    // --- Upsert transaction_history ---
    const volumeUsd = Math.max(amountInUsd, amountOutUsd);
    const pnlUsd = amountOutUsd - amountInUsd;

    const txRow = {
      wallet_address: walletAddress,
      tx_hash: txHash,
      tx_type: 'swap',
      ...DAFTAR_DAPP,
      token_in: tokenIn,
      token_out: tokenOut,
      amount_in: amountIn,
      amount_out: amountOut,
      amount_in_usd: amountInUsd,
      amount_out_usd: amountOutUsd,
      pnl_usd: pnlUsd,
      gas_fee: gasFee,
      status: 'success',
      tx_timestamp: txTimestamp,
      fetched_at: new Date().toISOString(),
      source: 'daftar_swap',
    };

    const { error: txError } = await supabase
      .from('transaction_history')
      .upsert(txRow, { onConflict: 'tx_hash' });

    if (txError) {
      console.error('[swap/record] Failed to upsert transaction:', txError);
      return sendJson(res, 500, { error: 'Failed to record transaction' });
    }

    // --- Upsert dapp_swap_stats ---
    const { data: existingStats } = await supabase
      .from('dapp_swap_stats')
      .select('total_swaps, total_volume_usd')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    const prevSwaps = toSafeNumber(existingStats?.total_swaps);
    const prevVolume = toSafeNumber(existingStats?.total_volume_usd);

    const { error: statsError } = await supabase
      .from('dapp_swap_stats')
      .upsert({
        wallet_address: walletAddress,
        total_swaps: prevSwaps + 1,
        total_volume_usd: prevVolume + volumeUsd,
        last_swap_at: txTimestamp,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'wallet_address' });

    if (statsError) {
      console.error('[swap/record] Failed to upsert swap stats:', statsError);
      // Don't fail the request — tx was already recorded
    }

    return sendJson(res, 200, {
      success: true,
      txHash,
      recorded: true,
      stats: {
        totalSwaps: prevSwaps + 1,
        totalVolumeUsd: prevVolume + volumeUsd,
      },
    });
  } catch (error) {
    console.error('[swap/record] Unexpected error:', error);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
}
