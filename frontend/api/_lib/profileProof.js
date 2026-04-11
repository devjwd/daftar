import { createHash } from 'crypto';
import { Ed25519PublicKey, Ed25519Signature } from '@aptos-labs/ts-sdk';

const PROFILE_MIGRATION_TTL_MS = 10 * 60 * 1000;

const normalizeHex = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  const prefixed = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-f]+$/i.test(prefixed)) return '';

  const compact = prefixed.replace(/^0+/, '') || '0';
  return `0x${compact}`;
};

const decodeBase64 = (value) => Buffer.from(String(value || ''), 'base64').toString('utf8');

const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256Hex = (value) => createHash('sha256').update(String(value || '')).digest('hex');

const deriveAddress = (publicKeyHex) => {
  const publicKey = new Ed25519PublicKey(normalizeHex(publicKeyHex));
  return normalizeAddress(String(publicKey.authKey().derivedAddress()));
};

const verifySignature = ({ fullMessage, publicKeyHex, signatureHex }) => {
  const publicKey = new Ed25519PublicKey(normalizeHex(publicKeyHex));
  const signature = new Ed25519Signature(normalizeHex(signatureHex));
  return publicKey.verifySignature({
    message: new TextEncoder().encode(fullMessage),
    signature,
  });
};

export const verifyProfileMigrationProof = async ({ req, payload, expectedAction, expectedAddress }) => {
  const claimedAddress = normalizeAddress(req.headers?.['x-profile-address']);
  const publicKey = normalizeHex(req.headers?.['x-profile-public-key']);
  const signature = normalizeHex(req.headers?.['x-profile-signature']);
  const messageB64 = String(req.headers?.['x-profile-message-b64'] || '');
  const fullMessageB64 = String(req.headers?.['x-profile-full-message-b64'] || '');

  if (!claimedAddress || !publicKey || !signature || !messageB64 || !fullMessageB64) {
    return { ok: false, error: 'Missing profile migration proof headers' };
  }

  let message = '';
  let fullMessage = '';
  let proof = {};

  try {
    message = decodeBase64(messageB64);
    fullMessage = decodeBase64(fullMessageB64);
    proof = JSON.parse(message);
  } catch {
    return { ok: false, error: 'Invalid profile migration proof payload' };
  }

  const proofAction = String(proof.action || '');
  const proofAddress = normalizeAddress(proof.address);
  const nonce = String(proof.nonce || '');
  const issuedAt = Date.parse(String(proof.issuedAt || ''));
  const bodyHash = String(proof.bodyHash || '');

  if (proofAction !== expectedAction) {
    return { ok: false, error: 'Profile migration proof action mismatch' };
  }

  if (!proofAddress || proofAddress !== normalizeAddress(expectedAddress) || claimedAddress !== proofAddress) {
    return { ok: false, error: 'Profile migration proof address mismatch' };
  }

  if (!nonce || !Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > PROFILE_MIGRATION_TTL_MS) {
    return { ok: false, error: 'Profile migration proof has expired' };
  }

  const expectedHash = sha256Hex(stableStringify(payload || {}));
  if (bodyHash !== expectedHash) {
    return { ok: false, error: 'Profile migration proof body hash mismatch' };
  }

  if (!fullMessage.includes(`message: ${message}`) || !fullMessage.includes(`nonce: ${nonce}`)) {
    return { ok: false, error: 'Signed profile migration message mismatch' };
  }

  try {
    const derivedAddress = deriveAddress(publicKey);
    const verified = verifySignature({ fullMessage, publicKeyHex: publicKey, signatureHex: signature });

    if (!verified || derivedAddress !== claimedAddress) {
      return { ok: false, error: 'Invalid profile migration signature' };
    }
  } catch {
    return { ok: false, error: 'Invalid profile migration signature' };
  }

  return { ok: true, address: claimedAddress };
};