import nacl from 'tweetnacl';
import sha3 from 'js-sha3';
const { sha3_256 } = sha3;
import { createHash } from 'crypto';
import { normalizeAddress } from './utils.js';

const ADMIN_SIGNATURE_TTL_MS = 5 * 60 * 1000;

const normalizeHex = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const hexToBytes = (value) => {
  const normalized = normalizeHex(value).slice(2);
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error('Invalid hex value');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.substr(i, 2), 16);
  }
  return bytes;
};

/**
 * verifyAdminRequest
 * 
 * Verifies a signed request from an administrator.
 * Expects headers: x-admin-address, x-admin-signature, x-admin-timestamp, x-admin-action
 * 
 * Logic:
 * 1. Normalize and verify the address is the admin wallet.
 * 2. Check that the timestamp is fresh (prevent replay).
 * 3. Reconstruct the message and verify the signature.
 */
export async function verifyAdminRequest(req) {
  const address = normalizeAddress(req.headers['x-admin-address'] || '');
  const signature = String(req.headers['x-admin-signature'] || '');
  const timestamp = Number(req.headers['x-admin-timestamp'] || 0);
  const action = String(req.headers['x-admin-action'] || '');

  // 1. Verify Admin Wallet
  const adminWallet = normalizeAddress(process.env.ADMIN_WALLET_ADDRESS);
  if (!adminWallet) {
    throw new Error('ADMIN_WALLET_ADDRESS is not configured on server');
  }

  if (address !== adminWallet) {
    throw new Error('Unauthorized: Not an administrator wallet');
  }

  // 2. Check Timestamp (TTL)
  const now = Date.now();
  if (Math.abs(now - timestamp) > ADMIN_SIGNATURE_TTL_MS) {
    throw new Error('Request signature expired');
  }

  // 3. Verify Signature
  // Message format: "daftar-admin:${action}:${timestamp}:${jsonBodyHash}"
  const bodyHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  const messageStr = `daftar-admin:${action}:${timestamp}:${bodyHash}`;
  const messageBytes = new TextEncoder().encode(messageStr);

  try {
    const signatureBytes = hexToBytes(signature);
    const publicKeyBytes = hexToBytes(address);

    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    if (!isValid) {
      throw new Error('Invalid administrator signature');
    }

    return true;
  } catch (err) {
    console.warn('[AdminAuth] Signature verification failed:', err.message);
    throw new Error(`Authentication failed: ${err.message}`);
  }
}
