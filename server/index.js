import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { timingSafeEqual } from 'crypto';
import { kv } from '@vercel/kv';
import supabaseAdmin from './supabase.js';
import { runAdaptersForAddress } from './badgeAdapters/index.js';
import { getWalletAge, checkAccountExists } from './indexerClient.js';
import usersApi from './usersApi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 4000;
const ADMIN_API_KEY = process.env.BADGE_ADMIN_API_KEY || '';
const BADGE_STATE_FILE = process.env.BADGE_STATE_FILE || path.resolve(__dirname, '../data/badge-state.json');
const BADGE_CORS_ORIGIN = process.env.BADGE_CORS_ORIGIN || '*';
const LEADERBOARD_CACHE_KEY = 'leaderboard:top100';
const LEADERBOARD_CACHE_TTL_SECONDS = 300;

const userAwards = new Map(); // address => [{ badgeId, payload, awardedAt }]
const trackedAddresses = new Set();

let persistQueue = Promise.resolve();

const normalizeAddress = (address) => {
  const normalized = String(address || '').trim().toLowerCase();
  return normalized.startsWith('0x') ? normalized : `0x${normalized}`;
};

const isLikelyAddress = (address) => /^0x[a-f0-9]{1,128}$/i.test(String(address || '').trim());

const ensureDataDir = () => {
  fs.mkdirSync(path.dirname(BADGE_STATE_FILE), { recursive: true });
};

const queuePersistState = () => {
  persistQueue = persistQueue
    .then(async () => {
      ensureDataDir();
      const tmpPath = `${BADGE_STATE_FILE}.tmp`;
      const payload = {
        userAwards: Object.fromEntries(userAwards.entries()),
        trackedAddresses: Array.from(trackedAddresses),
        updatedAt: new Date().toISOString(),
      };
      await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      await fs.promises.rename(tmpPath, BADGE_STATE_FILE);
    })
    .catch((err) => {
      console.warn('[state] failed to persist badge state', err);
    });
  return persistQueue;
};

const loadPersistedState = () => {
  try {
    if (!fs.existsSync(BADGE_STATE_FILE)) return;
    const raw = fs.readFileSync(BADGE_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.userAwards && typeof parsed.userAwards === 'object') {
      Object.entries(parsed.userAwards).forEach(([addr, awards]) => {
        if (Array.isArray(awards)) {
          userAwards.set(normalizeAddress(addr), awards);
        }
      });
    }
    if (parsed && Array.isArray(parsed.trackedAddresses)) {
      parsed.trackedAddresses.forEach((addr) => {
        if (isLikelyAddress(addr)) trackedAddresses.add(normalizeAddress(addr));
      });
    }
  } catch (err) {
    console.warn('[state] failed to load persisted badge state', err);
  }
};

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

const requireAdmin = (req, res, next) => {
  if (!ADMIN_API_KEY) {
    return res.status(503).json({ error: 'Server missing BADGE_ADMIN_API_KEY' });
  }
  const key = String(req.get('x-admin-key') || '');
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

const awardBadge = (address, badgeId, payload = {}) => {
  const normalized = normalizeAddress(address);
  const list = userAwards.get(normalized) || [];
  const record = { badgeId, payload, awardedAt: new Date().toISOString() };
  list.push(record);
  userAwards.set(normalized, list);
  return record;
};

const readLeaderboardCache = async () => {
  try {
    const cached = await kv.get(LEADERBOARD_CACHE_KEY);
    return Array.isArray(cached) ? cached : null;
  } catch (error) {
    console.warn('[leaderboard] cache read failed', error);
    return null;
  }
};

const writeLeaderboardCache = async (leaderboard) => {
  try {
    await kv.set(LEADERBOARD_CACHE_KEY, leaderboard, { ex: LEADERBOARD_CACHE_TTL_SECONDS });
  } catch (error) {
    console.warn('[leaderboard] cache write failed', error);
  }
};

const invalidateLeaderboardCache = async () => {
  try {
    await kv.del(LEADERBOARD_CACHE_KEY);
  } catch (error) {
    console.warn('[leaderboard] cache invalidate failed', error);
  }
};

const app = express();
app.use(cors(BADGE_CORS_ORIGIN === '*' ? undefined : { origin: BADGE_CORS_ORIGIN.split(',').map((v) => v.trim()) }));
app.use(express.json({ limit: '32kb' }));

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
loadPersistedState();

app.get('/api/leaderboard', async (req, res) => {
  const cached = await readLeaderboardCache();
  if (cached) {
    return res.json(cached);
  }

  const { data, error } = await supabaseAdmin
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

app.get('/api/badges/user/:address', (req, res) => {
  const addr = normalizeAddress(req.params.address);
  res.json(userAwards.get(addr) || []);
});

app.post('/api/badges/award', requireAdmin, adminWriteRateLimit, async (req, res) => {
  const { address, badgeId, payload } = req.body || {};
  if (!address || !badgeId || !isLikelyAddress(address)) {
    return res.status(400).json({ error: 'address and badgeId required' });
  }
  const record = awardBadge(address, badgeId, payload);
  await invalidateLeaderboardCache();
  trackedAddresses.add(normalizeAddress(address));
  await queuePersistState();
  res.json(record);
});

app.post('/api/badges/claim', requireAdmin, adminWriteRateLimit, async (req, res) => {
  const { address, badgeId, payload } = req.body || {};
  if (!address || !badgeId || !isLikelyAddress(address)) {
    return res.status(400).json({ error: 'address and badgeId required' });
  }
  const record = awardBadge(address, badgeId, payload);
  await invalidateLeaderboardCache();
  trackedAddresses.add(normalizeAddress(address));
  await queuePersistState();
  return res.json(record);
});

app.post('/api/badges/track', requireAdmin, adminWriteRateLimit, async (req, res) => {
  const { address } = req.body || {};
  if (!address || !isLikelyAddress(address)) return res.status(400).json({ error: 'valid address required' });
  trackedAddresses.add(normalizeAddress(address));
  await queuePersistState();
  res.json({ tracked: Array.from(trackedAddresses) });
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
  console.log('[worker] scanning', trackedAddresses.size, 'addresses');
  let changed = false;
  for (const addr of trackedAddresses) {
    try {
      const awards = await runAdaptersForAddress(addr, badgeConfigs);
      awards.forEach((a) => {
        const existing = userAwards.get(addr) || [];
        if (!existing.some((r) => r.badgeId === a.badgeId)) {
          awardBadge(addr, a.badgeId, a.extra || {});
          changed = true;
          console.log(`[worker] awarded ${a.badgeId} to ${addr}`);
        }
      });
    } catch (e) {
      console.warn('[worker] error scanning', addr, e);
    }
  }
  if (changed) {
    await queuePersistState();
  }
};

cron.schedule('0 * * * *', () => {
  performScan();
});

app.post('/api/badges/scan', requireAdmin, adminScanRateLimit, async (req, res) => {
  await performScan();
  res.json({ status: 'scanned', tracked: Array.from(trackedAddresses) });
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
