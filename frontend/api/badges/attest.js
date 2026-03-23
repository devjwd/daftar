import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import { runAdaptersForAddress } from '../_lib/badgeAdapters/index.js';
import { loadResolvedBadgeConfigs } from '../_lib/badgeConfigsState.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';

const METHODS = ['POST', 'OPTIONS'];
const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;
const textEncoder = new TextEncoder();

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const normalizePrivateKey = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const getAttestorAccount = () => {
  const privateKeyHex = normalizePrivateKey(process.env.BADGE_ATTESTOR_PRIVATE_KEY);
  if (!privateKeyHex) {
    return { ok: false, reason: 'BADGE_ATTESTOR_PRIVATE_KEY is missing' };
  }

  try {
    const privateKey = new Ed25519PrivateKey(privateKeyHex);
    const account = Account.fromPrivateKey({ privateKey });
    return { ok: true, account };
  } catch {
    return { ok: false, reason: 'BADGE_ATTESTOR_PRIVATE_KEY is invalid' };
  }
};

const createAttestationMessage = ({ walletAddress, badgeId }) => {
  return `daftar.badge.attest:v1:${walletAddress}:${badgeId}`;
};

const signAttestation = ({ account, walletAddress, badgeId }) => {
  const message = createAttestationMessage({ walletAddress, badgeId });
  const signature = account.sign(textEncoder.encode(message));
  return Buffer.from(signature.toUint8Array()).toString('hex');
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  try {
    const ip = getClientIp(req);
    const limiter = enforceRateLimit({
      key: `badges:attest:${ip}`,
      limit: Number(process.env.BADGES_ATTEST_RATE_LIMIT || 20),
      windowMs: Number(process.env.BADGES_ATTEST_RATE_WINDOW_MS || 60_000),
    });

    if (!limiter.ok) {
      res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
      return sendJson(res, 429, { error: 'Too many requests' });
    }

    const walletAddress = normalizeAddress(req.body?.walletAddress || req.body?.address);
    const badgeId = String(req.body?.badgeId || '').trim();

    if (!walletAddress || !badgeId) {
      return sendJson(res, 400, { error: 'walletAddress and badgeId are required' });
    }

    if (!ADDRESS_RE.test(walletAddress)) {
      return sendJson(res, 400, { error: 'Invalid walletAddress format' });
    }

    const attestor = getAttestorAccount();
    if (!attestor.ok) {
      return sendJson(res, 503, { error: attestor.reason });
    }

    const { configs: badgeConfigs } = await loadResolvedBadgeConfigs();
    const config = badgeConfigs.find((candidate) => String(candidate?.badgeId) === badgeId);
    if (!config) {
      return sendJson(res, 404, {
        error: 'Badge not found in server configuration',
        hint: 'publish_scanner_config',
      });
    }

    const candidates = await runAdaptersForAddress(walletAddress, [config]);
    const eligible = candidates.some((candidate) => String(candidate?.badgeId) === badgeId);

    if (!eligible) {
      return sendJson(res, 403, { error: 'Wallet is not eligible for this badge' });
    }

    const signature = signAttestation({
      account: attestor.account,
      walletAddress,
      badgeId,
    });

    return sendJson(res, 200, {
      success: true,
      ok: true,
      signature,
    });
  } catch (error) {
    console.error('[badges/attest] request failed', error);
    return sendJson(res, 500, {
      error: String(error?.message || 'Internal server error').slice(0, 240),
    });
  }
}
