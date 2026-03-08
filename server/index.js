import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// in-memory storage (would normally be a database)
const userAwards = new Map(); // address => [{ badgeId, payload, awardedAt }]
const trackedAddresses = new Set();

// helper utilities
const awardBadge = (address, badgeId, payload = {}) => {
  const normalized = String(address).toLowerCase();
  const list = userAwards.get(normalized) || [];
  const record = { badgeId, payload, awardedAt: new Date().toISOString() };
  list.push(record);
  userAwards.set(normalized, list);
  return record;
};

const app = express();
app.use(cors());
app.use(express.json());

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

// routes
app.get('/api/badges', (req, res) => {
  // simple listing: just return the configs
  res.json(badgeConfigs);
});

app.get('/api/badges/user/:address', (req, res) => {
  const addr = String(req.params.address).toLowerCase();
  res.json(userAwards.get(addr) || []);
});

app.post('/api/badges/award', (req, res) => {
  const { address, badgeId, payload } = req.body || {};
  if (!address || !badgeId) {
    return res.status(400).json({ error: 'address and badgeId required' });
  }
  const record = awardBadge(address, badgeId, payload);
  // auto-track address for worker
  trackedAddresses.add(String(address).toLowerCase());
  res.json(record);
});

app.post('/api/badges/track', (req, res) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address required' });
  trackedAddresses.add(String(address).toLowerCase());
  res.json({ tracked: Array.from(trackedAddresses) });
});

// worker logic - runs periodically and on demand
import { runAdaptersForAddress } from '../frontend/src/services/badgeAdapters/index.js';

const performScan = async () => {
  console.log('[worker] scanning', trackedAddresses.size, 'addresses');
  for (const addr of trackedAddresses) {
    try {
      const awards = await runAdaptersForAddress(addr, badgeConfigs);
      awards.forEach((a) => {
        const existing = userAwards.get(addr) || [];
        // avoid duplicates
        if (!existing.some((r) => r.badgeId === a.badgeId)) {
          awardBadge(addr, a.badgeId, a.extra || {});
          console.log(`[worker] awarded ${a.badgeId} to ${addr}`);
        }
      });
    } catch (e) {
      console.warn('[worker] error scanning', addr, e);
    }
  }
};

// schedule job once every hour
cron.schedule('0 * * * *', () => {
  performScan();
});

// allow manual trigger via query param
app.get('/api/badges/scan', async (req, res) => {
  await performScan();
  res.json({ status: 'scanned', tracked: Array.from(trackedAddresses) });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Badge service listening on port ${PORT}`);
  if (process.argv.includes('--worker')) {
    // run an immediate scan if invoked with --worker
    performScan();
  }
});
