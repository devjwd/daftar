import nacl from 'tweetnacl';
import { createHash } from 'crypto';
import { normalizeAddress } from '../utils/address.ts';
import { Request } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

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

const stableStringify = (value: any): string => {
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

  // 3. Nonce Check (Replay Protection)
  const supabase = req.app.get('supabaseAdmin') as SupabaseClient;
  
  // Extract nonce from message (if constructing) or from header if available
  // For robustness, we check the database for the exact (address, timestamp, nonce) triplet
  const nonce = String(req.headers['x-admin-nonce'] || 'none'); 

  if (supabase) {
    const { data: existingNonce } = await supabase
      .from('admin_nonces')
      .select('id')
      .eq('address', address)
      .eq('timestamp', timestamp)
      .eq('nonce', nonce)
      .maybeSingle();

    if (existingNonce) {
      throw new Error('Request already processed (Replay detected)');
    }

    // Record this nonce immediately
    await supabase.from('admin_nonces').insert({
      address,
      timestamp,
      nonce,
      created_at: new Date().toISOString()
    }).catch(err => console.warn('[AdminAuth] Failed to record nonce:', err.message));
  }

  // 4. Verify Signature
  // Message format: "daftar-admin:${action}:${timestamp}:${nonce}:${jsonBodyHash}"
  const bodyHash = createHash('sha256').update(stableStringify(req.body)).digest('hex');
  const messageStr = `daftar-admin:${action}:${timestamp}:${nonce}:${bodyHash}`;
  
  const fullMessageB64 = String(req.headers['x-admin-full-message-b64'] || '');
  
  try {
    const signatureBytes = hexToBytes(signature);
    const publicKeyBytes = hexToBytes(publicKey || address);

    let messageBytes: Uint8Array;
    if (fullMessageB64) {
      messageBytes = new Uint8Array(Buffer.from(fullMessageB64, 'base64'));
    } else {
      messageBytes = new TextEncoder().encode(messageStr);
    }

    let isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);

    // Legacy Fallback (without nonce)
    if (!isValid && !fullMessageB64) {
      const legacyMessageStr = `daftar-admin:${action}:${timestamp}:${bodyHash}`;
      const aptosMessage = `APTOS\nmessage: ${legacyMessageStr}\nnonce: ${timestamp}`;
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

