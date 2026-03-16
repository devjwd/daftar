/**
 * POST /api/badges/attest
 *
 * User-triggered automatic on-chain attestation.
 *
 * When the frontend detects that a wallet is eligible for a badge that requires
 * an allowlist attestation, it calls this endpoint.  The server re-evaluates
 * eligibility and, if confirmed, adds the address to the on-chain allowlist so
 * the user can immediately mint their SBT badge without waiting for an admin.
 *
 * Body: { address: string, badgeId: string }
 *
 * Returns:
 *   200 { ok: true, alreadyAllowlisted, txHash, attestor }
 *   400 Invalid request
 *   403 Not eligible
 *   503 Attestation not configured / failed
 */
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { attestBadgeAllowlistOnChain, getAttestationReadiness } from '../_lib/onchainAttestation.js';
import { runAdaptersForAddress } from '../_lib/badgeAdapters/index.js';
import { loadResolvedBadgeConfigs } from '../_lib/badgeConfigsState.js';
import { loadState, saveState } from '../_lib/state.js';

const METHODS = ['POST', 'OPTIONS'];

const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;

const normalizeAddress = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return s.startsWith('0x') ? s : `0x${s}`;
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') return methodNotAllowed(res, req.method, METHODS);

  const ip = getClientIp(req);

  // Strict per-IP rate limit – attestation submits on-chain transactions
  const limiter = enforceRateLimit({
    key: `badges:attest:${ip}`,
    limit: Number(process.env.BADGES_ATTEST_RATE_LIMIT || 20),
    windowMs: Number(process.env.BADGES_ATTEST_RATE_WINDOW_MS || 60_000),
  });
  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const { address, badgeId } = req.body || {};

  if (!address || !badgeId) {
    return sendJson(res, 400, { error: 'address and badgeId are required' });
  }

  const addr = normalizeAddress(address);
  if (!ADDRESS_RE.test(addr)) {
    return sendJson(res, 400, { error: 'Invalid address format' });
  }

  // ── Load badge configuration ──────────────────────────────────────────────
  const { configs: badgeConfigs } = await loadResolvedBadgeConfigs();
  const config = badgeConfigs.find((c) => String(c?.badgeId) === String(badgeId));
  if (!config) {
    return sendJson(res, 404, { error: 'Badge not found in configuration' });
  }

  const onChainBadgeId = config.onChainBadgeId ?? null;
  if (onChainBadgeId == null) {
    // Badge has no on-chain component; nothing to attest
    return sendJson(res, 200, { ok: true, noAttestation: true, reason: 'Badge does not require on-chain attestation' });
  }

  // min_balance badges verify eligibility fully on-chain inside mint_with_balance;
  // they don't use the allowlist so attestation is not needed for them.
  const isMinBalance = config.rule === 2 /* BADGE_RULES.MIN_BALANCE */;
  if (isMinBalance) {
    return sendJson(res, 200, { ok: true, noAttestation: true, reason: 'min_balance badge uses on-chain verification' });
  }

  // ── Check attestation service readiness ────────────────────────────────────
  const readiness = getAttestationReadiness();
  if (!readiness.ready) {
    return sendJson(res, 503, { error: `Attestation not available: ${readiness.reason}` });
  }

  // ── Re-evaluate eligibility server-side ────────────────────────────────────
  let eligible = false;
  try {
    const candidates = await runAdaptersForAddress(addr, [config]);
    eligible = candidates.some((c) => String(c?.badgeId) === String(badgeId));
  } catch (err) {
    console.error('[attest] eligibility check failed', err.message);
    return sendJson(res, 503, { error: 'Eligibility check failed. Please try again.' });
  }

  if (!eligible) {
    return sendJson(res, 403, { error: 'Address is not eligible for this badge' });
  }

  // ── Perform on-chain attestation (add to allowlist) ──────────────────────
  const attestation = await attestBadgeAllowlistOnChain({ ownerAddress: addr, onChainBadgeId });

  if (!attestation.ok) {
    return sendJson(res, 503, { error: attestation.reason || 'On-chain attestation failed' });
  }

  // ── Persist award record in server state ─────────────────────────────────
  try {
    const { userAwards, trackedAddresses } = await loadState();
    const existing = userAwards[addr] || [];
    const alreadyRecorded = existing.some((r) => String(r.badgeId) === String(badgeId));

    if (!alreadyRecorded) {
      existing.push({
        badgeId,
        payload: {
          onChainBadgeId,
          attested: true,
          attestationTxHash: attestation.txHash || null,
          attestedAt: new Date().toISOString(),
          alreadyAllowlisted: Boolean(attestation.alreadyAllowlisted),
          attestor: attestation.attestor || null,
          autoAttested: true,
        },
        awardedAt: new Date().toISOString(),
      });
      userAwards[addr] = existing;

      // Add to tracked addresses if not already tracked
      const updatedTracked = trackedAddresses.includes(addr)
        ? trackedAddresses
        : [...trackedAddresses, addr];

      await saveState(userAwards, updatedTracked);
    }
  } catch (err) {
    // Non-fatal: attestation succeeded on-chain, log and continue
    console.warn('[attest] failed to persist award record', err.message);
  }

  return sendJson(res, 200, {
    ok: true,
    badgeId,
    onChainBadgeId,
    alreadyAllowlisted: Boolean(attestation.alreadyAllowlisted),
    txHash: attestation.txHash || null,
    attestor: attestation.attestor || null,
  });
}
