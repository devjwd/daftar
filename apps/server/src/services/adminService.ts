import nacl from 'tweetnacl';
import { createHash } from 'crypto';
import { normalizeAddress } from '../utils/address.ts';
import { Request } from 'express';

const ADMIN_SIGNATURE_TTL_MS = 5 * 60 * 1000;

const normalizeHex = (value: string | null | undefined): string => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const hexToBytes = (value: string): Uint8Array => {
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
 */
export async function verifyAdminRequest(req: Request): Promise<boolean> {
  const address = normalizeAddress((req.headers['x-admin-address'] as string) || '');
  const signature = String(req.headers['x-admin-signature'] || '');
  const publicKey = normalizeHex((req.headers['x-admin-public-key'] as string) || '');
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
  if (!timestamp || Math.abs(now - timestamp) > ADMIN_SIGNATURE_TTL_MS) {
    throw new Error('Request signature expired');
  }

  // 3. Verify Signature
  // Message format: "daftar-admin:${action}:${timestamp}:${jsonBodyHash}"
  const bodyHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  const messageStr = `daftar-admin:${action}:${timestamp}:${bodyHash}`;
  
  const fullMessageB64 = String(req.headers['x-admin-full-message-b64'] || '');
  
  try {
    const signatureBytes = hexToBytes(signature);
    // Use provided public key or fall back to address (backward compatibility/legacy scripts)
    const publicKeyBytes = hexToBytes(publicKey || address);

    // If we have the full message (exactly as signed by the wallet), use it.
    // Otherwise, construct the expected message string.
    let messageBytes: Uint8Array;
    if (fullMessageB64) {
      messageBytes = new Uint8Array(Buffer.from(fullMessageB64, 'base64'));
    } else {
      messageBytes = new TextEncoder().encode(messageStr);
    }

    let isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);

    // If verification fails and we didn't have a full message, try the legacy Aptos prefix
    if (!isValid && !fullMessageB64) {
      const aptosMessage = `APTOS\nmessage: ${messageStr}\nnonce: ${timestamp}`;
      isValid = nacl.sign.detached.verify(
        new TextEncoder().encode(aptosMessage),
        signatureBytes,
        publicKeyBytes
      );
    }

    if (!isValid) {
      throw new Error('Invalid administrator signature');
    }

    return true;
  } catch (err: any) {
    console.warn('[AdminAuth] Signature verification failed:', err.message);
    throw new Error(`Authentication failed: ${err.message}`);
  }
}

