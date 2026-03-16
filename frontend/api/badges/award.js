/**
 * POST /api/badges/award
 * Awards a badge to a wallet address (admin only).
 *
 * Body: { address: string, badgeId: string, payload?: object }
 * Header: x-admin-key: <BADGE_ADMIN_API_KEY>
 */
import { loadState, saveState } from '../_lib/state.js';
import { checkAdmin } from '../_lib/auth.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { attestBadgeAllowlistOnChain, getAttestationReadiness } from '../_lib/onchainAttestation.js';
import { loadResolvedBadgeConfigs } from '../_lib/badgeConfigsState.js';

const normalizeAddress = (address) => {
  const n = String(address || '').trim().toLowerCase();
  return n.startsWith('0x') ? n : `0x${n}`;
};

const isLikelyAddress = (address) =>
  /^0x[a-f0-9]{1,128}$/i.test(String(address || '').trim());

const METHODS = ['POST', 'OPTIONS'];

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `badges:award:write:${ip}`,
    limit: Number(process.env.BADGES_WRITE_RATE_LIMIT || 40),
    windowMs: Number(process.env.BADGES_WRITE_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const auth = checkAdmin(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const { address, badgeId, payload, onChainBadgeId } = req.body || {};
  if (!address || !badgeId || !isLikelyAddress(address)) {
    return sendJson(res, 400, { error: 'address and badgeId required' });
  }

  const { configs: badgeConfigs } = await loadResolvedBadgeConfigs();
  const config = badgeConfigs.find((entry) => String(entry?.badgeId) === String(badgeId));
  const resolvedOnChainBadgeId =
    onChainBadgeId ??
    config?.onChainBadgeId ??
    payload?.onChainBadgeId ??
    null;

  if (resolvedOnChainBadgeId != null) {
    const readiness = getAttestationReadiness();
    if (!readiness.ready) {
      return sendJson(res, 503, {
        error: 'On-chain attestation is not configured',
        reason: readiness.reason,
      });
    }
  }

  const { userAwards, trackedAddresses } = await loadState();
  const addr = normalizeAddress(address);

  const list = userAwards[addr] || [];
  const existing = list.find((entry) => String(entry?.badgeId) === String(badgeId));
  if (existing) {
    return sendJson(res, 200, existing);
  }

  let attestation = null;
  if (resolvedOnChainBadgeId != null) {
    attestation = await attestBadgeAllowlistOnChain({
      ownerAddress: addr,
      onChainBadgeId: resolvedOnChainBadgeId,
    });

    if (!attestation.ok) {
      return sendJson(res, 502, {
        error: 'On-chain attestation failed',
        reason: attestation.reason,
      });
    }
  }

  const record = {
    badgeId,
    payload: {
      ...(payload || {}),
      onChainBadgeId: resolvedOnChainBadgeId,
      attested: Boolean(attestation?.ok),
      attestationTxHash: attestation?.txHash || null,
      attestedAt: attestation ? new Date().toISOString() : null,
      alreadyAllowlisted: Boolean(attestation?.alreadyAllowlisted),
      attestor: attestation?.attestor || null,
    },
    awardedAt: new Date().toISOString(),
  };
  list.push(record);
  userAwards[addr] = list;

  // auto-track the address for the background scanner
  if (!trackedAddresses.includes(addr)) trackedAddresses.push(addr);

  await saveState(userAwards, trackedAddresses);
  return sendJson(res, 200, record);
}
