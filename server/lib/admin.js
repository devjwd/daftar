import nacl from 'tweetnacl';
import { sha3_256 } from 'js-sha3';
import { createHash } from 'crypto';

const ADMIN_SIGNATURE_TTL_MS = 5 * 60 * 1000;

const normalizeHex = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

export const normalizeAddress = (value) => {
  const normalized = normalizeHex(value);
  if (!normalized) return '';
  const withoutPrefix = normalized.slice(2);
  if (!/^[0-9a-f]+$/i.test(withoutPrefix)) return '';
  return `0x${withoutPrefix.padStart(64, '0')}`;
};

const hexToBytes = (value) => {
  const normalized = normalizeHex(value).slice(2);
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error('Invalid hex value');
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
};

const decodeBase64 = (value) => {
  return Buffer.from(value, 'base64').toString('utf8');
};

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

const sha256Hex = (value) => {
  return createHash('sha256').update(value).digest('hex');
};

const deriveAptosAddress = (publicKeyHex) => {
  const publicKeyBytes = hexToBytes(publicKeyHex);
  const authenticationKey = sha3_256(new Uint8Array([...publicKeyBytes, 0x00]));
  return normalizeAddress(`0x${authenticationKey}`);
};

export const verifyAdminRequest = (
  req,
  payload,
  expectedAction,
) => {
  const allowedAddress = normalizeAddress(process.env.ADMIN_WALLET_ADDRESS);
  if (!allowedAddress) {
    throw new Error('ADMIN_WALLET_ADDRESS secret is not configured');
  }

  const claimedAddress = normalizeAddress(req.headers['x-admin-address']);
  const publicKey = normalizeHex(req.headers['x-admin-public-key']);
  const signature = normalizeHex(req.headers['x-admin-signature']);
  const messageB64 = String(req.headers['x-admin-message-b64'] || '');
  const fullMessageB64 = String(req.headers['x-admin-full-message-b64'] || '');

  if (!claimedAddress || !publicKey || !signature || !messageB64 || !fullMessageB64) {
    return { ok: false, error: 'Missing admin proof headers', status: 401 };
  }

  let message = '';
  let fullMessage = '';
  let proof = {};

  try {
    message = decodeBase64(messageB64);
    fullMessage = decodeBase64(fullMessageB64);
    proof = JSON.parse(message);
  } catch {
    return { ok: false, error: 'Invalid admin proof payload', status: 401 };
  }

  const issuedAt = Date.parse(String(proof.issuedAt ?? ''));
  const nonce = String(proof.nonce ?? '');
  const action = String(proof.action ?? '');
  const bodyHash = String(proof.bodyHash ?? '');

  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > ADMIN_SIGNATURE_TTL_MS) {
    return { ok: false, error: 'Admin proof has expired', status: 401 };
  }

  if (!nonce || action !== expectedAction) {
    return { ok: false, error: 'Admin proof action mismatch', status: 401 };
  }

  const expectedHash = sha256Hex(stableStringify(payload));
  if (bodyHash !== expectedHash) {
    return { ok: false, error: 'Admin proof body hash mismatch', status: 401 };
  }

  if (!fullMessage.includes(`message: ${message}`) || !fullMessage.includes(`nonce: ${nonce}`)) {
    return { ok: false, error: 'Signed message content mismatch', status: 401 };
  }

  let verified = false;
  let derivedAddress = '';
  try {
    verified = nacl.sign.detached.verify(
      new TextEncoder().encode(fullMessage),
      hexToBytes(signature),
      hexToBytes(publicKey),
    );
    derivedAddress = deriveAptosAddress(publicKey);
  } catch (err) {
    return { ok: false, error: 'Invalid admin signature', status: 401 };
  }

  if (!verified || claimedAddress !== derivedAddress || derivedAddress !== allowedAddress) {
    return { ok: false, error: 'Unauthorized admin signer', status: 401 };
  }

  return { ok: true, adminAddress: derivedAddress };
};
