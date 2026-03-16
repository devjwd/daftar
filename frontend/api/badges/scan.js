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
import { attestBadgeAllowlistOnChain, getAttestationReadiness } from '../_lib/onchainAttestation.js';
import { loadResolvedBadgeConfigs } from '../_lib/badgeConfigsState.js';

const METHODS = ['POST', 'OPTIONS'];

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

  const { configs: badgeConfigs } = await loadResolvedBadgeConfigs();
  const configByBadgeId = new Map(
    badgeConfigs.map((config) => [String(config?.badgeId || ''), config])
  );
  const { userAwards, trackedAddresses } = await loadState();

  const readiness = getAttestationReadiness();

  let changed = false;
  const awarded = [];
  const attestationFailures = [];

  for (const addr of trackedAddresses) {
    try {
      const candidates = await runAdaptersForAddress(addr, badgeConfigs);
      const existing = userAwards[addr] || [];

      for (const candidate of candidates) {
        const alreadyAwarded = existing.some((r) => r.badgeId === candidate.badgeId);
        if (!alreadyAwarded) {
          const config = configByBadgeId.get(String(candidate.badgeId || ''));
          const resolvedOnChainBadgeId =
            config?.onChainBadgeId ??
            candidate?.extra?.onChainBadgeId ??
            null;

          let attestation = null;
          if (resolvedOnChainBadgeId != null) {
            if (!readiness.ready) {
              attestationFailures.push({
                addr,
                badgeId: candidate.badgeId,
                reason: readiness.reason,
              });
              continue;
            }

            attestation = await attestBadgeAllowlistOnChain({
              ownerAddress: addr,
              onChainBadgeId: resolvedOnChainBadgeId,
            });

            if (!attestation.ok) {
              attestationFailures.push({
                addr,
                badgeId: candidate.badgeId,
                reason: attestation.reason,
              });
              continue;
            }
          }

          const record = {
            badgeId: candidate.badgeId,
            payload: {
              ...(candidate.extra || {}),
              onChainBadgeId: resolvedOnChainBadgeId,
              attested: Boolean(attestation?.ok),
              attestationTxHash: attestation?.txHash || null,
              attestedAt: attestation ? new Date().toISOString() : null,
              alreadyAllowlisted: Boolean(attestation?.alreadyAllowlisted),
              attestor: attestation?.attestor || null,
            },
            awardedAt: new Date().toISOString(),
          };
          existing.push(record);
          changed = true;
          awarded.push({
            addr,
            badgeId: candidate.badgeId,
            onChainBadgeId: resolvedOnChainBadgeId,
            attestationTxHash: attestation?.txHash || null,
          });
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
    attestationFailures,
  });
}
