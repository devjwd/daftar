/**
 * POST /api/badges/verify-eligibility
 * Checks whether a wallet meets the criteria for a specific badge type.
 *
 * Body: {
 *   walletAddress: string,
 *   criteriaType: 'TRANSACTION_COUNT' | 'DAYS_ONCHAIN' | 'DEX_VOLUME',
 *   params: { minCount?: number, minDays?: number, minVolume?: number }
 * }
 *
 * Returns: { eligible: boolean, reason: string }
 *
 * Rate-limited to 10 requests per wallet per minute.
 */
import { createClient } from '@supabase/supabase-js';
import { checkAccountExists, getWalletAge } from '../_lib/indexerClient.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp } from '../_lib/http.js';

const ADDRESS_PATTERN = /^0x[a-f0-9]{1,128}$/i;

const normalizeAddress = (address) => {
  const n = String(address || '').trim().toLowerCase();
  return n.startsWith('0x') ? n : `0x${n}`;
};

const isLikelyAddress = (address) => ADDRESS_PATTERN.test(String(address || '').trim());

const createSupabaseAdmin = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

// ── Criteria verifiers ──────────────────────────────────────────────────────

const verifyTransactionCount = async (wallet, params) => {
  const minCount = Number(params?.minCount ?? 1);
  const { txCount } = await checkAccountExists(wallet);
  if (txCount >= minCount) {
    return { eligible: true, reason: `Wallet has ${txCount} transactions (required: ${minCount})` };
  }
  return { eligible: false, reason: `Wallet has ${txCount} transactions, needs ${minCount}` };
};

const verifyDaysOnchain = async (wallet, params) => {
  const minDays = Number(params?.minDays ?? 1);
  const { firstTxTimestamp } = await getWalletAge(wallet);
  if (!firstTxTimestamp) {
    return { eligible: false, reason: 'No transaction history found for this wallet' };
  }
  const daysOnchain = Math.floor(
    (Date.now() - new Date(firstTxTimestamp).getTime()) / 86_400_000
  );
  if (daysOnchain >= minDays) {
    return {
      eligible: true,
      reason: `Wallet has been on-chain for ${daysOnchain} days (required: ${minDays})`,
    };
  }
  return {
    eligible: false,
    reason: `Wallet has been on-chain for ${daysOnchain} days, needs ${minDays}`,
  };
};

const verifyDexVolume = async (wallet, params) => {
  const minVolume = Number(params?.minVolume ?? 0);
  const mosaicApiUrl =
    process.env.MOSAIC_API_URL || 'https://api.mosaic.ag/v1';
  try {
    const url = `${mosaicApiUrl}/accounts/${encodeURIComponent(wallet)}/volume`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return { eligible: false, reason: 'DEX volume data unavailable' };
    }
    const data = await response.json();
    const volume = Number(data?.volume ?? data?.total_volume ?? 0);
    if (volume >= minVolume) {
      return {
        eligible: true,
        reason: `DEX swap volume $${volume.toFixed(2)} meets required $${minVolume}`,
      };
    }
    return {
      eligible: false,
      reason: `DEX swap volume $${volume.toFixed(2)} is below required $${minVolume}`,
    };
  } catch {
    return { eligible: false, reason: 'DEX volume data unavailable' };
  }
};

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', process.env.BADGE_CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }

    // Ensure required server-side Supabase envs are present for runtime parity.
    const supabase = createSupabaseAdmin();
    void supabase;

    const { walletAddress, criteriaType, params } = req.body || {};

    if (!walletAddress || !criteriaType) {
      return res.status(400).json({
        eligible: false,
        reason: 'walletAddress and criteriaType are required',
      });
    }

    if (!isLikelyAddress(walletAddress)) {
      return res.status(400).json({
        eligible: false,
        reason: 'Invalid wallet address format',
      });
    }

    const wallet = normalizeAddress(walletAddress);

    // Per-wallet rate limit: 10 requests per minute
    const ip = getClientIp(req);
    const rateLimitKey = `verify-eligibility:${wallet}:${ip}`;
    const limiter = enforceRateLimit({
      key: rateLimitKey,
      limit: Number(process.env.VERIFY_ELIGIBILITY_RATE_LIMIT || 10),
      windowMs: 60_000,
    });

    if (!limiter.ok) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
      return res.status(429).json({
        eligible: false,
        reason: 'Rate limit exceeded. Try again in a minute.',
      });
    }

    switch (criteriaType) {
      case 'TRANSACTION_COUNT':
        return res.status(200).json(await verifyTransactionCount(wallet, params));
      case 'DAYS_ONCHAIN':
        return res.status(200).json(await verifyDaysOnchain(wallet, params));
      case 'DEX_VOLUME':
        return res.status(200).json(await verifyDexVolume(wallet, params));
      default:
        return res.status(400).json({
          eligible: false,
          reason: `Unknown criteriaType: ${criteriaType}`,
        });
    }
  } catch (err) {
    console.error('[verify-eligibility] error:', err);
    return res.status(500).json({
      eligible: false,
      reason: 'Verification failed due to an internal error',
    });
  }
}
