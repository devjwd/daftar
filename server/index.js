import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { Ed25519PublicKey, Ed25519Signature } from '@aptos-labs/ts-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use(
  cors({
    origin: process.env.BADGE_CORS_ORIGIN ? process.env.BADGE_CORS_ORIGIN.split(',') : ['http://localhost:3000', 'http://localhost:3001', 'https://www.daftar.fi', 'https://daftar.fi'],
    credentials: true,
  })
);

const { SUPABASE_URL, PORT = '3001' } = process.env;
const PAGE_SIZE = 20;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  try {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[Server] Supabase admin initialized');
  } catch (err) {
    console.error('[Server] Failed to initialize Supabase:', err.message);
  }
} else {
  console.warn('[Server] Supabase credentials missing - Badge management will be disabled');
}

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const stripped = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[a-f0-9]+$/i.test(stripped)) return '';
  const compact = stripped.replace(/^0+/, '') || '0';
  return `0x${compact}`;
};

const parseSignaturePayload = (signature) => {
  if (signature && typeof signature === 'object') return signature;
  if (typeof signature !== 'string') return null;
  try {
    return JSON.parse(signature);
  } catch {
    return null;
  }
};

export const verifyWalletSignature = (walletAddress, message, signature, maxAgeMinutes = 5) => {
  const parsed = parseSignaturePayload(signature);
  const publicKeyHex = String(parsed?.publicKey || parsed?.public_key || '').trim();
  const signatureHex = String(parsed?.signature || parsed?.sig || '').trim();

  if (!publicKeyHex || !signatureHex || !message) {
    return false;
  }

  // Parse message for timestamp/nonce if it's JSON
  let signedAt = null;
  try {
    const msgObj = typeof message === 'string' && message.startsWith('{') ? JSON.parse(message) : null;
    if (msgObj?.issuedAt) {
      signedAt = new Date(msgObj.issuedAt).getTime();
    }
  } catch {
    // Ignore parse error on message, treat as raw string
  }

  // Strict Timestamp Check (Replay Protection Layer 1)
  if (maxAgeMinutes && signedAt) {
    const ageMs = Date.now() - signedAt;
    if (ageMs < 0 || ageMs > maxAgeMinutes * 60 * 1000) {
      return false; // Message expired or from the future
    }
  }

  try {
    const publicKey = new Ed25519PublicKey(publicKeyHex);
    const aptosSignature = new Ed25519Signature(signatureHex);
    const verified = publicKey.verifySignature({
      message: new TextEncoder().encode(String(message)),
      signature: aptosSignature,
    });

    if (!verified) return false;

    const derivedAddress = normalizeAddress(String(publicKey.authKey().derivedAddress()));
    return derivedAddress === normalizeAddress(walletAddress);
  } catch {
    return false;
  }
};

const oneMinuteMs = 60 * 1000;

const badgeLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const awardLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const profileLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 30, // 30 requests per minute for viewing profiles
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for profile lookups' },
});

const generalLimiter = rateLimit({
  windowMs: oneMinuteMs,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * In-Memory Request Cache
 * Prevents DB spam for identical hot-path GET requests.
 */
const MEMORY_CACHE = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds

const getCached = (key) => {
  const entry = MEMORY_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    MEMORY_CACHE.delete(key);
    return null;
  }
  return entry.data;
};

const setCached = (key, data) => {
  MEMORY_CACHE.set(key, { data, timestamp: Date.now() });
  // Periodic cleanup
  if (MEMORY_CACHE.size > 1000) {
    const oldestKey = MEMORY_CACHE.keys().next().value;
    MEMORY_CACHE.delete(oldestKey);
  }
};

/**
 * Global Database-Backed Rate Limiter
 * Prevents IP rotation/horizontal scaling bypass by storing limits in Supabase.
 */
const checkRateLimit = async (key, windowMs, maxRequests) => {
  if (!supabaseAdmin) return { ok: true }; // Skip if DB not configured

  try {
    const { data, error } = await supabaseAdmin.rpc('increment_api_rate_limit', {
      p_key: key,
      p_window_start: new Date().toISOString(),
      p_window_ms: windowMs
    });

    if (error) {
      console.error('[RateLimit] DB error:', error);
      return { ok: false, error: 'Rate limit service error' }; // Fail closed
    }

    const currentCount = data?.[0]?.count || 1;
    return {
      ok: currentCount <= maxRequests,
      count: currentCount,
      resetAt: data?.[0]?.reset_at
    };
  } catch (err) {
    console.error('[RateLimit] Critical error:', err.message);
    return { ok: false, error: 'Rate limit service failure' }; // Fail closed
  }
};

/**
 * Replay Protection: Check and burn nonce
 */
const checkAndBurnNonce = async (address, nonce, ttlMinutes = 5) => {
  if (!supabaseAdmin) return { ok: true };

  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  try {
    // Attempt to insert. If it exists, it will fail due to PK constraint (wallet_address, nonce)
    const { error } = await supabaseAdmin
      .from('used_nonces')
      .insert({
        wallet_address: normalizeAddress(address),
        nonce: String(nonce),
        expires_at: expiresAt
      });

    if (error) {
      if (error.code === '23505') { // Unique violation
        return { ok: false, error: 'Nonce already used (Replay Attack detected)' };
      }
      console.error('[Nonce] DB error:', error.message);
      return { ok: false, error: 'Nonce verification error' }; // Fail closed
    }

    return { ok: true };
  } catch (err) {
    console.error('[Nonce] Critical error:', err.message);
    return { ok: false, error: 'Nonce service failure' }; // Fail closed
  }
};

/**
 * Sybil Resistance: Check wallet activity on Movement
 */
const checkMovementActivity = async (address, minTransactions = 5) => {
  const normalized = normalizeAddress(address);
  const rpcUrl = process.env.MOVEMENT_RPC_URL || 'https://testnet.movementnetwork.xyz/v1';

  try {
    const response = await fetch(`${rpcUrl}/accounts/${normalized}`);
    if (!response.ok) {
      if (response.status === 404) return { ok: false, error: 'Wallet has no on-chain history (Sybil protection)' };
      throw new Error(`RPC status ${response.status}`);
    }

    const accountData = await response.json();
    const sequenceNumber = Number(accountData?.sequence_number || 0);

    return {
      ok: sequenceNumber >= minTransactions,
      count: sequenceNumber
    };
  } catch (err) {
    console.error('[Sybil] RPC check failed:', err.message);
    return { ok: true }; // Fail open on RPC error to avoid blocking valid users
  }
};

const TOKEN_COINGECKO_IDS = {
  '0xa': 'movement',
  '0x1': 'movement',
  '0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d': 'tether',
  '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39': 'usd-coin',
  '0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650': 'usd-coin',
  '0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c': 'ethena-usde',
  '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376': 'ethereum',
  '0xe956f5062c3b9cba00e82dc775d29acf739ffa1e612e619062423b58afdbf035': 'wrapped-eeth',
  '0x2f6af255328fe11b88d840d1e367e946ccd16bd7ebddd6ee7e2ef9f7ae0c53ef': 'renzo-restaked-eth',
  '0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d': 'kelp-dao-restaked-eth',
  '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c': 'bitcoin',
  '0x0658f4ef6f76c8eeffdc06a30946f3f06723a7f9532e2413312b2a612183759c': 'lombard-staked-btc',
  '0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d': 'solv-protocol-solvbtc',
};

const FALLBACK_PRICES = {
  '0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d': 1.0,
  '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39': 1.0,
  '0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650': 1.0,
};

let cachedSnapshot = {
  prices: { ...FALLBACK_PRICES },
  priceChanges: {},
  updatedAt: 0,
};

app.use('/api/badges', badgeLimiter);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/badges/user/:walletAddress', async (req, res) => {
  const walletAddress = normalizeAddress(req.params.walletAddress);
  if (!walletAddress) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Badge service currently unavailable (DB config missing)' });
  }

  const { data, error } = await supabaseAdmin
    .from('badge_attestations')
    .select('*, badge_definitions(*)')
    .eq('wallet_address', walletAddress)
    .eq('eligible', true)
    .order('awarded_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to fetch badges' });
  }

  return res.status(200).json({ awards: Array.isArray(data) ? data : [] });
});

// GET /api/badges/definitions - Get all available badges
app.get('/api/badges/definitions', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  const { data, error } = await supabaseAdmin
    .from('badge_definitions')
    .select('*')
    .eq('enabled', true)
    .eq('is_active', true);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ badges: data || [] });
});

// GET /api/leaderboard - Get top users sorted by XP
app.get('/api/leaderboard', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  const limit = Math.min(parseInt(req.query.limit || '100'), 100);

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('wallet_address, username, avatar_url, xp')
    .order('xp', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Server] Leaderboard fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }

  return res.status(200).json({
    leaderboard: data.map(d => ({
      ...d,
      address: d.wallet_address // Match frontend camelCase
    }))
  });
});

app.post('/api/badges/track', async (req, res) => {
  const walletAddress = normalizeAddress(req.body?.walletAddress);
  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  const { error } = await supabaseAdmin
    .from('badge_tracked_addresses')
    .upsert(
      {
        wallet_address: walletAddress,
        added_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' }
    );

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to track address' });
  }

  return res.status(200).json({ ok: true, walletAddress });
});

app.post('/api/badges/award', awardLimiter, async (req, res) => {
  const walletAddress = normalizeAddress(req.body?.walletAddress);
  const signedMessage = String(req.body?.signedMessage || '').trim();
  const signature = req.body?.signature;
  const badgeId = String(req.body?.badgeId || '').trim();
  const nonce = req.body?.nonce;
  const metadata = req.body?.metadata || {};

  if (!walletAddress || !signedMessage || !signature || !badgeId) {
    return res.status(400).json({ error: 'walletAddress, badgeId, signedMessage, and signature are required' });
  }

  // 1. Global Rate Limit (DB Backed)
  const rateLimit = await checkRateLimit(`award:${walletAddress}`, 60000, 10);
  if (!rateLimit.ok) {
    return res.status(429).json({ error: 'Too many award attempts', reset_at: rateLimit.resetAt });
  }

  // 2. Replay Protection: Nonce Check
  if (nonce) {
    const nonceCheck = await checkAndBurnNonce(walletAddress, nonce);
    if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });
  }

  const isValid = verifyWalletSignature(walletAddress, signedMessage, signature);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid wallet signature or expired message' });
  }

  // 3. Eligibility Verification (Harden against self-attestation)
  try {
    const { data: verifyData, error: verifyError } = await supabaseAdmin.functions.invoke('verify-badge', {
      body: { wallet_address: walletAddress, badge_id: badgeId },
      headers: {
        'x-api-key': process.env.VERIFY_BADGE_API_KEY || ''
      }
    });

    if (verifyError) throw verifyError;
    if (!verifyData?.eligible) {
      return res.status(403).json({
        error: 'Not eligible for this badge',
        reason: verifyData?.reason || 'Criteria not met'
      });
    }
  } catch (err) {
    console.error('[Award] Eligibility check failed:', err.message);
    return res.status(500).json({ error: 'Failed to verify badge eligibility' });
  }

  const txHash = metadata.txHash || null;
  const awardedAt = new Date().toISOString();
  const proofHash = verifyData?.proof_hash || null;

  const { error } = await supabaseAdmin.from('badge_attestations').upsert(
    {
      wallet_address: walletAddress,
      badge_id: badgeId,
      eligible: true,
      awarded_at: awardedAt,
      tx_hash: txHash,
      proof_hash: proofHash,
      metadata: metadata
    },
    { onConflict: 'wallet_address,badge_id' }
  );

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to write attestation' });
  }

  return res.status(200).json({ ok: true, walletAddress, badgeId, awardedAt });
});

// --- PRICE API ROUTE ---
app.get('/api/prices', async (req, res) => {
  const now = Date.now();

  try {
    if (!supabaseAdmin) throw new Error('DB connection required for production price cache');

    // 1. Check Database Cache First (Production Hardening)
    const { data: cachedRows } = await supabaseAdmin
      .from('price_cache')
      .select('*')
      .gt('cached_at', new Date(now - 30 * 1000).toISOString()); // 30 second validity

    if (cachedRows && cachedRows.length > 0) {
      const prices = {};
      const priceChanges = {};

      // Map DB cache to response format
      cachedRows.forEach(row => {
        prices[row.token_id] = Number(row.price_usd);
        priceChanges[row.token_id] = Number(row.change_24h || 0);
      });

      return res.status(200).json({
        prices,
        priceChanges,
        updatedAt: new Date(cachedRows[0].cached_at).getTime(),
        source: 'db-cache'
      });
    }

    // 2. Refresh from External API if cache stale
    const ids = Array.from(new Set(Object.values(TOKEN_COINGECKO_IDS))).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Daftar-Portfolio/1.1'
      }
    });

    if (!response.ok) throw new Error(`CoinGecko status ${response.status}`);

    const data = await response.json();
    const prices = { ...FALLBACK_PRICES };
    const priceChanges = {};
    const dbInserts = [];

    Object.entries(TOKEN_COINGECKO_IDS).forEach(([address, geckoId]) => {
      const usd = data[geckoId]?.usd;
      if (usd !== undefined) {
        prices[address] = usd;
        priceChanges[address] = data[geckoId]?.usd_24h_change || 0;
        dbInserts.push({
          token_id: address,
          price_usd: usd,
          change_24h: data[geckoId]?.usd_24h_change || 0,
          cached_at: new Date().toISOString()
        });
      }
    });

    // 3. Update DB Cache in background
    if (dbInserts.length > 0) {
      supabaseAdmin.from('price_cache').upsert(dbInserts, { onConflict: 'token_id' }).then(({ error }) => {
        if (error) console.error('[PriceEngine] DB cache update failed:', error.message);
      });
    }

    return res.status(200).json({ prices, priceChanges, updatedAt: now, source: 'network' });
  } catch (error) {
    console.warn('[Server] Price refresh failed:', error.message);
    return res.status(200).json({
      prices: cachedSnapshot.prices,
      stale: true,
      source: 'memory-fallback'
    });
  }
});

// --- TRANSACTION API ROUTES ---

// GET /api/badges/eligibility
app.get('/api/badges/eligibility', generalLimiter, async (req, res) => {
  const { wallet, badgeId } = req.query;
  if (!wallet || !badgeId) return res.status(400).json({ error: 'wallet and badgeId are required' });

  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    // Invoke the Supabase Edge Function to do the heavy lifting
    const { data, error } = await supabaseAdmin.functions.invoke('verify-badge', {
      body: { wallet_address: wallet, badge_id: badgeId },
      headers: {
        'x-api-key': process.env.VERIFY_BADGE_API_KEY || ''
      }
    });

    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) {
    console.error('[Server] Eligibility check error:', error);
    return res.status(500).json({ error: 'Failed to verify eligibility' });
  }
});

// POST /api/badges/track
app.post('/api/badges/track', generalLimiter, async (req, res) => {
  const wallet = normalizeAddress(req.query.wallet);
  if (!wallet) return res.status(400).json({ error: 'wallet address is required' });

  const page = Math.max(1, parseInt(req.query.page || '1'));
  const type = req.query.type || 'all';

  const { error } = await supabaseAdmin
    .from('profiles') // Changed to profiles since we don't have badge_tracked_addresses
    .update({ updated_at: new Date().toISOString() })
    .eq('wallet_address', wallet);

  if (error) {
    return res.status(500).json({ error: error.message || 'Failed to track address' });
  }

  return res.status(200).json({ ok: true, walletAddress: wallet });
});

// GET /api/transactions
app.get('/api/transactions', generalLimiter, async (req, res) => {
  const wallet = normalizeAddress(req.query.wallet);
  if (!wallet) return res.status(400).json({ error: 'wallet address is required' });

  const page = Math.max(1, parseInt(req.query.page || '1'));
  const type = req.query.type || 'all';
  const cacheKey = `tx:${wallet}:${page}:${type}`;

  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json(cached);

  if (!supabaseAdmin) return res.status(503).json({ error: 'Database service unavailable' });

  try {
    let query = supabaseAdmin
      .from('transaction_history')
      .select('*', { count: 'exact' })
      .eq('wallet_address', wallet)
      .order('tx_timestamp', { ascending: false });

    if (type !== 'all') {
      // Basic type filtering
      if (type === 'transfers') {
        query = query.in('tx_type', ['transfer', 'received']);
      } else {
        query = query.eq('tx_type', type);
      }
    }

    const { data, count, error } = await query
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (error) throw error;

    const result = {
      transactions: data || [],
      total: count || 0,
      page,
      hasMore: (count || 0) > page * PAGE_SIZE,
    };
    setCached(cacheKey, result);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[Server] Transaction fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// --- PROFILE API ROUTES ---

// GET /api/profiles/:address
app.get('/api/profiles/:address', profileLimiter, async (req, res) => {
  const address = normalizeAddress(req.params.address);
  if (!address) return res.status(400).json({ error: 'Invalid address' });

  const cacheKey = `profile:${address}`;
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json(cached);

  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Profile service unavailable' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('wallet_address', address)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(200).json({ address, username: '', bio: '' });
    }

    // Convert DB snake_case to Frontend camelCase if necessary
    const profile = {
      address: data.wallet_address,
      username: data.username,
      bio: data.bio,
      avatar_url: data.avatar_url,
      xp: data.xp,
      twitter: data.twitter,
      telegram: data.telegram,
      updatedAt: data.updated_at,
      createdAt: data.created_at
    };
    setCached(cacheKey, profile);
    return res.status(200).json(profile);
  } catch (error) {
    console.error('[Server] Profile fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST /api/profiles - Save/Update
app.post('/api/profiles', async (req, res) => {
  const { address, username, bio, avatar_url, twitter, telegram, signature, signedMessage, nonce } = req.body;

  // Support multiple naming conventions for profile picture
  const finalAvatarUrl = avatar_url || req.body.avatarUrl || req.body.pfp;
  const normalizedAddr = normalizeAddress(address);

  if (!normalizedAddr) return res.status(400).json({ error: 'Invalid address' });

  // Verification
  if (!signature || !signedMessage) {
    return res.status(401).json({ error: 'Signature required for profile updates' });
  }

  // 1. Global Rate Limit (DB Backed)
  const rateLimit = await checkRateLimit(`profile_upd:${normalizedAddr}`, 60000, 5);
  if (!rateLimit.ok) return res.status(429).json({ error: 'Rate limit exceeded' });

  // 2. Replay Protection: Nonce
  if (nonce) {
    const nonceCheck = await checkAndBurnNonce(normalizedAddr, nonce);
    if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });
  }

  const isValid = verifyWalletSignature(normalizedAddr, signedMessage, signature);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature or expired proof' });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Profile service unavailable' });
  }

  try {
    // 3. Sybil Resistance: Only check for NEW profiles
    const { data: existing } = await supabaseAdmin.from('profiles').select('id').eq('wallet_address', normalizedAddr).maybeSingle();
    if (!existing) {
      const activity = await checkMovementActivity(normalizedAddr, 5);
      if (!activity.ok) {
        return res.status(403).json({
          error: 'Sybil Protection: Wallet must have at least 5 on-chain transactions to register.',
          count: activity.count || 0
        });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .upsert({
        wallet_address: normalizedAddr,
        username: username || '',
        bio: bio || '',
        avatar_url: finalAvatarUrl || null,
        twitter: twitter || '',
        telegram: telegram || '',
        updated_at: new Date().toISOString()
      }, { onConflict: 'wallet_address' })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      ...data,
      address: data.wallet_address // Ensure camelCase consistency
    });
  } catch (error) {
    console.error('[Server] Profile save error:', error);
    return res.status(500).json({ error: 'Failed to save profile' });
  }
});

// DELETE /api/profiles/:address
app.delete('/api/profiles/:address', async (req, res) => {
  const address = normalizeAddress(req.params.address);
  const { signature, signedMessage, nonce } = req.body;

  if (!address) return res.status(400).json({ error: 'Invalid address' });
  if (!signature || !signedMessage) {
    return res.status(401).json({ error: 'Signature required' });
  }

  // Rate Limit
  const rateLimit = await checkRateLimit(`profile_del:${address}`, 3600000, 3); // Max 3 deletes per hour
  if (!rateLimit.ok) return res.status(429).json({ error: 'Too many delete attempts' });

  // Nonce
  if (nonce) {
    const nonceCheck = await checkAndBurnNonce(address, nonce);
    if (!nonceCheck.ok) return res.status(403).json({ error: nonceCheck.error });
  }

  const isValid = verifyWalletSignature(address, signedMessage, signature);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('wallet_address', address);

    if (error) throw error;
    return res.status(200).json({ deleted: true });
  } catch (error) {
    console.error('[Server] Profile delete error:', error);
    return res.status(500).json({ error: 'Failed to delete profile' });
  }
});

// GET /api/profiles - List/Search
app.get('/api/profiles', generalLimiter, async (req, res) => {
  const query = req.query.query;
  const limit = Math.min(parseInt(req.query.limit || '20'), 50);

  // Apply DB-backed rate limit to search (prevent scraping)
  if (query) {
    const searchRateLimit = await checkRateLimit('search_api', 60000, 100);
    if (!searchRateLimit.ok) return res.status(429).json({ error: 'Search rate limit exceeded' });
  }

  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    let supabaseQuery = supabaseAdmin.from('profiles').select('*').limit(limit);

    if (query) {
      // Sanitize query to prevent PostgREST injection
      const sanitized = String(query).replace(/[(),.:]/g, '');
      supabaseQuery = supabaseQuery.or(`username.ilike.%${sanitized}%,wallet_address.ilike.%${sanitized}%`);
    }

    const { data, error } = await supabaseQuery;
    if (error) throw error;

    return res.status(200).json(data.map(d => ({
      ...d,
      address: d.wallet_address
    })));
  } catch (error) {
    console.error('[Server] Profile search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(Number(PORT), () => {
    // eslint-disable-next-line no-console
    console.log(`Badge API listening on ${PORT}`);
  });
}

export default app;