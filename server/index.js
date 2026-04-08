// LEGACY BACKEND — NOT USED BY ACTIVE FRONTEND
// All active badge routes are in frontend/api/badges/
// This file is kept for reference only
// DO NOT DEPLOY THIS SERVER ALONGSIDE THE VERCEL DEPLOYMENT

import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { timingSafeEqual } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { runAdaptersForAddress } from './badgeAdapters/index.js';
import { getWalletAge, checkAccountExists } from './indexerClient.js';
import usersApi from './usersApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 4000;
const ADMIN_API_KEY = process.env.BADGE_ADMIN_API_KEY || '';
const BADGE_CORS_ORIGIN = process.env.BADGE_CORS_ORIGIN || '*';
const LEADERBOARD_CACHE_KEY = 'leaderboard:top100';
const LEADERBOARD_CACHE_TTL_SECONDS = 300;
const LEADERBOARD_CACHE_ENABLED = Boolean(
  String(process.env.KV_REST_API_URL || '').trim() &&
  String(process.env.KV_REST_API_TOKEN || '').trim()
);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Missing Supabase environment variables. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const normalizeAddress = (address) => {
  const normalized = String(address || '').trim().toLowerCase();
  return normalized.startsWith('0x') ? normalized : `0x${normalized}`;
};

const isLikelyAddress = (address) => /^0x[a-f0-9]{1,128}$/i.test(String(address || '').trim());

const createRateLimiter = ({ windowMs, max }) => {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip}:${req.path}`;
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    return next();
  };
};

const requireApiKey = (req, res, next) => {
  if (!ADMIN_API_KEY) {
    return res.status(503).json({ error: 'Server missing BADGE_ADMIN_API_KEY' });
  }
  const key = String(req.headers['x-api-key'] || '');
  const expected = String(ADMIN_API_KEY || '');

  const keyBuffer = Buffer.from(key, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const valid =
    keyBuffer.length > 0 &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);

  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
};

const mapAttestationToAward = (row) => ({
  badgeId: String(row?.badge_id || ''),
  payload: {
    eligible: row?.eligible === true,
    proofHash: row?.proof_hash || null,
  },
  awardedAt: row?.verified_at || null,
});

const getUserAwardRows = async (address) => {
  const normalized = normalizeAddress(address);
  const { data, error } = await supabase.from('badge_attestations').select('*').eq('wallet_address', normalized);

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
};

const getUserAwards = async (address) => {
  const rows = await getUserAwardRows(address);
  return rows.map(mapAttestationToAward);
};

const listTrackedAddresses = async () => {
  const { data, error } = await supabase.from('badge_tracked_addresses').select('*');

  if (error) {
    throw error;
  }

  return Array.from(
    new Set(
      (Array.isArray(data) ? data : [])
        .map((row) => normalizeAddress(row?.wallet_address))
        .filter((address) => isLikelyAddress(address))
    )
  );
};

const trackAddress = async (address, addedAt = new Date().toISOString()) => {
  const normalized = normalizeAddress(address);
  const { error } = await supabase.from('badge_tracked_addresses').upsert(
    {
      wallet_address: normalized,
      added_at: addedAt,
    },
    { onConflict: 'wallet_address' }
  );

  if (error) {
    throw error;
  }

  return normalized;
};

const awardBadge = async (address, badgeId, payload = {}) => {
  const normalized = normalizeAddress(address);
  const verifiedAt = new Date().toISOString();
  const proofHash = payload?.proof_hash ?? payload?.proofHash ?? null;

  const { error } = await supabase.from('badge_attestations').upsert(
    {
      wallet_address: normalized,
      badge_id: String(badgeId),
      eligible: true,
      verified_at: verifiedAt,
      proof_hash: proofHash,
    },
    { onConflict: 'wallet_address,badge_id' }
  );

  if (error) {
    throw error;
  }

  await trackAddress(normalized, verifiedAt);

  return {
    badgeId: String(badgeId),
    payload,
    awardedAt: verifiedAt,
  };
};

const readLeaderboardCache = async () => {
  if (!LEADERBOARD_CACHE_ENABLED) {
    return null;
  }

  try {
    const cached = await kv.get(LEADERBOARD_CACHE_KEY);
    return Array.isArray(cached) ? cached : null;
  } catch (error) {
    console.warn('[leaderboard] cache read failed', error);
    return null;
  }
};

const writeLeaderboardCache = async (leaderboard) => {
  if (!LEADERBOARD_CACHE_ENABLED) {
    return;
  }

  try {
    await kv.set(LEADERBOARD_CACHE_KEY, leaderboard, { ex: LEADERBOARD_CACHE_TTL_SECONDS });
  } catch (error) {
    console.warn('[leaderboard] cache write failed', error);
  }
};

const invalidateLeaderboardCache = async () => {
  if (!LEADERBOARD_CACHE_ENABLED) {
    return;
  }

  try {
    await kv.del(LEADERBOARD_CACHE_KEY);
  } catch (error) {
    console.warn('[leaderboard] cache invalidate failed', error);
  }
};

const app = express();
app.use(cors({ origin: BADGE_CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '32kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/users', usersApi);

const adminWriteRateLimit = createRateLimiter({ windowMs: 60_000, max: 30 });
const adminScanRateLimit = createRateLimiter({ windowMs: 60_000, max: 5 });

let badgeConfigs = [];
const loadBadgeConfigs = () => {
  try {
    const cfgPath = path.resolve(__dirname, '../scripts/badgeConfigs.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    badgeConfigs = JSON.parse(raw);
  } catch (e) {
    console.warn('could not load badgeConfigs.json', e);
    badgeConfigs = [];
  }
};
loadBadgeConfigs();

if (!LEADERBOARD_CACHE_ENABLED) {
  console.warn('[leaderboard] KV cache disabled; KV_REST_API_URL or KV_REST_API_TOKEN is missing');
}

app.get('/api/leaderboard', async (req, res) => {
  const cached = await readLeaderboardCache();
  if (cached) {
    return res.json(cached);
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('wallet_address, username, avatar_url, xp')
    .order('xp', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    console.error('[leaderboard] failed to fetch profiles', error);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }

  const leaderboard = (Array.isArray(data) ? data : []).map((row, index) => ({
    rank: index + 1,
    wallet_address: row.wallet_address,
    username: row.username,
    avatar_url: row.avatar_url,
    xp: Number(row.xp || 0),
  }));

  await writeLeaderboardCache(leaderboard);

  return res.json(leaderboard);
});

app.get('/api/badges', (req, res) => {
  res.json(badgeConfigs);
});

app.get('/api/badges/user/:address', async (req, res) => {
  const addr = normalizeAddress(req.params.address);
  try {
    const awards = await getUserAwards(addr);
    return res.json(awards);
  } catch (error) {
    console.error('[badges/user] failed to fetch attestations', error);
    return res.status(500).json({ error: 'Failed to fetch badge awards' });
  }
});

app.post('/api/badges/award', requireApiKey, adminWriteRateLimit, async (req, res) => {
  const { address, badgeId, payload } = req.body || {};
  if (!address || !badgeId || !isLikelyAddress(address)) {
    return res.status(400).json({ error: 'address and badgeId required' });
  }
  try {
    const record = await awardBadge(address, badgeId, payload);
    await invalidateLeaderboardCache();
    return res.json(record);
  } catch (error) {
    console.error('[badges/award] failed to persist badge attestation', error);
    return res.status(500).json({ error: 'Failed to award badge' });
  }
});

app.post('/api/badges/claim', requireApiKey, adminWriteRateLimit, async (req, res) => {
  const { address, badgeId, payload } = req.body || {};
  if (!address || !badgeId || !isLikelyAddress(address)) {
    return res.status(400).json({ error: 'address and badgeId required' });
  }
  try {
    const record = await awardBadge(address, badgeId, payload);
    await invalidateLeaderboardCache();
    return res.json(record);
  } catch (error) {
    console.error('[badges/claim] failed to persist badge attestation', error);
    return res.status(500).json({ error: 'Failed to claim badge' });
  }
});

app.post('/api/badges/track', requireApiKey, adminWriteRateLimit, async (req, res) => {
  const { address } = req.body || {};
  if (!address || !isLikelyAddress(address)) return res.status(400).json({ error: 'valid address required' });
  try {
    await trackAddress(address);
    const tracked = await listTrackedAddresses();
    return res.json({ tracked });
  } catch (error) {
    console.error('[badges/track] failed to persist tracked address', error);
    return res.status(500).json({ error: 'Failed to track address' });
  }
});

// ─── Per-wallet rate limiter for verify-eligibility (10 req/wallet/min) ───────
const verifyEligibilityBuckets = new Map();
const verifyEligibilityRateLimit = (req, res, next) => {
  const walletAddress = req.body?.walletAddress;
  const wallet = walletAddress && isLikelyAddress(walletAddress)
    ? normalizeAddress(walletAddress)
    : req.ip;
  const now = Date.now();
  const bucket = verifyEligibilityBuckets.get(wallet) || { count: 0, resetAt: now + 60_000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60_000;
  }
  bucket.count += 1;
  verifyEligibilityBuckets.set(wallet, bucket);
  if (bucket.count > 10) {
    return res.status(429).json({ eligible: false, reason: 'Rate limit exceeded. Try again in a minute.' });
  }
  return next();
};

// ─── Criteria verifiers ────────────────────────────────────────────────────────
const MOSAIC_API_URL = process.env.MOSAIC_API_URL || 'https://api.mosaic.ag/v1';

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
  const daysOnchain = Math.floor((Date.now() - new Date(firstTxTimestamp).getTime()) / 86_400_000);
  if (daysOnchain >= minDays) {
    return { eligible: true, reason: `Wallet has been on-chain for ${daysOnchain} days (required: ${minDays})` };
  }
  return { eligible: false, reason: `Wallet has been on-chain for ${daysOnchain} days, needs ${minDays}` };
};

const verifyDexVolume = async (wallet, params) => {
  const minVolume = Number(params?.minVolume ?? 0);
  try {
    const url = `${MOSAIC_API_URL}/accounts/${encodeURIComponent(wallet)}/volume`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return { eligible: false, reason: 'DEX volume data unavailable' };
    }
    const data = await response.json();
    const volume = Number(data?.volume ?? data?.total_volume ?? 0);
    if (volume >= minVolume) {
      return { eligible: true, reason: `DEX swap volume $${volume.toFixed(2)} meets required $${minVolume}` };
    }
    return { eligible: false, reason: `DEX swap volume $${volume.toFixed(2)} is below required $${minVolume}` };
  } catch {
    return { eligible: false, reason: 'DEX volume data unavailable' };
  }
};

// ─── POST /api/badges/verify-eligibility ──────────────────────────────────────
app.post('/api/badges/verify-eligibility', verifyEligibilityRateLimit, async (req, res) => {
  const { walletAddress, badgeId: _badgeId, criteriaType, params } = req.body || {};

  if (!walletAddress || !criteriaType) {
    return res.status(400).json({ eligible: false, reason: 'walletAddress and criteriaType are required' });
  }
  if (!isLikelyAddress(walletAddress)) {
    return res.status(400).json({ eligible: false, reason: 'Invalid wallet address format' });
  }

  const wallet = normalizeAddress(walletAddress);

  try {
    switch (criteriaType) {
      case 'TRANSACTION_COUNT':
        return res.json(await verifyTransactionCount(wallet, params));
      case 'DAYS_ONCHAIN':
        return res.json(await verifyDaysOnchain(wallet, params));
      case 'DEX_VOLUME':
        return res.json(await verifyDexVolume(wallet, params));
      default:
        return res.status(400).json({ eligible: false, reason: `Unknown criteriaType: ${criteriaType}` });
    }
  } catch (err) {
    console.error('[verify-eligibility] error:', err);
    return res.status(500).json({ eligible: false, reason: 'Verification failed due to an internal error' });
  }
});

const performScan = async () => {
  const trackedAddresses = await listTrackedAddresses();
  console.log('[worker] scanning', trackedAddresses.length, 'addresses');
  let changed = false;
  for (const addr of trackedAddresses) {
    try {
      const awards = await runAdaptersForAddress(addr, badgeConfigs);
      const existing = await getUserAwardRows(addr);
      const existingBadgeIds = new Set(existing.map((row) => String(row?.badge_id || '')));
      for (const award of awards) {
        if (!existingBadgeIds.has(String(award?.badgeId || ''))) {
          await awardBadge(addr, award.badgeId, award.extra || {});
          existingBadgeIds.add(String(award.badgeId));
          changed = true;
          console.log(`[worker] awarded ${award.badgeId} to ${addr}`);
        }
      }
    } catch (e) {
      console.warn('[worker] error scanning', addr, e);
    }
  }
  if (changed) {
    await invalidateLeaderboardCache();
  }
};

cron.schedule('0 * * * *', () => {
  performScan();
});

app.post('/api/badges/scan', requireApiKey, adminScanRateLimit, async (req, res) => {
  try {
    await performScan();
    const tracked = await listTrackedAddresses();
    return res.json({ status: 'scanned', tracked });
  } catch (error) {
    console.error('[badges/scan] scan failed', error);
    return res.status(500).json({ error: 'Failed to scan tracked addresses' });
  }
});

app.listen(PORT, () => {
  console.log(`Badge service listening on port ${PORT}`);
  if (!ADMIN_API_KEY) {
    console.warn('BADGE_ADMIN_API_KEY is missing; admin endpoints are disabled until configured.');
  }
  if (process.argv.includes('--worker')) {
    performScan();
  }
});
