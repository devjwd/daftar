import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 4000;
const ADMIN_API_KEY = process.env.BADGE_ADMIN_API_KEY || '';
const BADGE_STATE_FILE = process.env.BADGE_STATE_FILE || path.resolve(__dirname, '../data/badge-state.json');
const BADGE_CORS_ORIGIN = process.env.BADGE_CORS_ORIGIN || '*';

// in-memory storage (would normally be a database)
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
  const key = req.get('x-admin-key') || req.query.adminKey || req.body?.adminKey;
  if (key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
};

// helper utilities
const awardBadge = (address, badgeId, payload = {}) => {
  const normalized = normalizeAddress(address);
  const list = userAwards.get(normalized) || [];
  const record = { badgeId, payload, awardedAt: new Date().toISOString() };
  list.push(record);
  userAwards.set(normalized, list);
  return record;
};

const app = express();
app.use(cors(BADGE_CORS_ORIGIN === '*' ? undefined : { origin: BADGE_CORS_ORIGIN.split(',').map((v) => v.trim()) }));
app.use(express.json({ limit: '32kb' }));

const adminWriteRateLimit = createRateLimiter({ windowMs: 60_000, max: 30 });
const adminScanRateLimit = createRateLimiter({ windowMs: 60_000, max: 5 });

// expose badge configurations (load from shared file)
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

// routes
app.get('/api/badges', (req, res) => {
  // simple listing: just return the configs
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
  // auto-track address for worker
  trackedAddresses.add(normalizeAddress(address));
  await queuePersistState();
  res.json(record);
});

app.post('/api/badges/track', requireAdmin, adminWriteRateLimit, async (req, res) => {
  const { address } = req.body || {};
  if (!address || !isLikelyAddress(address)) return res.status(400).json({ error: 'valid address required' });
  trackedAddresses.add(normalizeAddress(address));
  await queuePersistState();
  res.json({ tracked: Array.from(trackedAddresses) });
});

// worker logic - runs periodically and on demand
import { runAdaptersForAddress } from './badgeAdapters/index.js';

const performScan = async () => {
  console.log('[worker] scanning', trackedAddresses.size, 'addresses');
  let changed = false;
  for (const addr of trackedAddresses) {
    try {
      const awards = await runAdaptersForAddress(addr, badgeConfigs);
      awards.forEach((a) => {
        const existing = userAwards.get(addr) || [];
        // avoid duplicates
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

// schedule job once every hour
cron.schedule('0 * * * *', () => {
  performScan();
});

// allow manual trigger via authenticated endpoint
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
    // run an immediate scan if invoked with --worker
    performScan();
  }
});
