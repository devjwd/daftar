/**
 * POST /api/badges/scan
 * Runs badge eligibility adapters for all tracked addresses and awards any
 * badges that have been earned.  Admin only.
 *
 * Header: x-admin-key: <BADGE_ADMIN_API_KEY>
 *
 * This endpoint can also be called by a Vercel Cron Job.
 * Add the following to vercel.json to run it hourly:
 *
 *   "crons": [{ "path": "/api/badges/scan", "schedule": "0 * * * *" }]
 *
 * When using cron, protect the route with CRON_SECRET (Vercel injects it
 * automatically) and check req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`.
 */
import { loadState, saveState } from '../_lib/state.js';
import { checkAdmin } from '../_lib/auth.js';
import { runAdaptersForAddress } from '../_lib/badgeAdapters/index.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const METHODS = ['POST', 'OPTIONS'];

const loadBadgeConfigs = () => {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../_lib/badgeConfigs.json'), 'utf8'));
  } catch {
    return [];
  }
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `badges:scan:write:${ip}`,
    limit: Number(process.env.BADGES_WRITE_RATE_LIMIT || 40),
    windowMs: Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  // Allow both admin-key auth and Vercel Cron secret auth
  const cronSecret = process.env.CRON_SECRET;
  const isCron =
    cronSecret &&
    req.headers['authorization'] === `Bearer ${cronSecret}`;

  if (!isCron) {
    const auth = checkAdmin(req);
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
  }

  const badgeConfigs = loadBadgeConfigs();
  const { userAwards, trackedAddresses } = await loadState();

  let changed = false;
  const awarded = [];

  for (const addr of trackedAddresses) {
    try {
      const candidates = await runAdaptersForAddress(addr, badgeConfigs);
      const existing = userAwards[addr] || [];

      for (const candidate of candidates) {
        const alreadyAwarded = existing.some((r) => r.badgeId === candidate.badgeId);
        if (!alreadyAwarded) {
          const record = {
            badgeId: candidate.badgeId,
            payload: candidate.extra || {},
            awardedAt: new Date().toISOString(),
          };
          existing.push(record);
          changed = true;
          awarded.push({ addr, badgeId: candidate.badgeId });
          console.log(`[scan] awarded ${candidate.badgeId} to ${addr}`);
        }
      }

      userAwards[addr] = existing;
    } catch (e) {
      console.warn('[scan] error scanning', addr, e.message);
    }
  }

  if (changed) await saveState(userAwards, trackedAddresses);

  return sendJson(res, 200, {
    status: 'ok',
    tracked: trackedAddresses.length,
    awarded,
  });
}
