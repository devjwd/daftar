import { Ed25519PublicKey, Ed25519Signature } from '@aptos-labs/ts-sdk';
import { normalizeAddress } from './address.ts';
import fs from 'fs';

interface SignaturePayload {
  publicKey?: string;
  public_key?: string;
  public_key_hex?: string;
  signature?: string | { signature?: string };
  sig?: string;
  sig_hex?: string;
  [key: string]: unknown;
}

export const parseSignaturePayload = (signature: unknown): SignaturePayload | null => {
  if (signature && typeof signature === 'object') return signature as SignaturePayload;
  if (typeof signature !== 'string') return null;
  try {
    return JSON.parse(signature) as SignaturePayload;
  } catch {
    return null;
  }
};

export const sigVerificationLogs: string[] = [];

export const verifyWalletSignature = (
  walletAddress: string,
  message: string,
  signaturePayload: unknown,
  maxAgeMinutes: number = 5
): boolean => {
  const logFail = (reason: string, details?: any) => {
    const logStr = `[${new Date().toISOString()}] FAIL: ${reason}\n` +
      `Wallet: ${walletAddress}\n` +
      `Message: ${String(message)}\n` +
      `Payload: ${JSON.stringify(signaturePayload, null, 2)}\n` +
      `Details: ${JSON.stringify(details || {}, null, 2)}\n` +
      `--------------------\n`;
    sigVerificationLogs.push(logStr);
    if (sigVerificationLogs.length > 100) {
      sigVerificationLogs.shift();
    }
    try {
      fs.appendFileSync('sig_debug.log', logStr);
    } catch (e: any) {
      console.error('Failed to write to sig_debug.log:', e.message);
    }
  };

  const parsed = parseSignaturePayload(signaturePayload);

  // Extract values, handling potential nesting (e.g. from some wallets)
  let publicKeyInput = parsed?.publicKey || parsed?.public_key || parsed?.public_key_hex;
  let signatureInput = parsed?.signature || parsed?.sig || parsed?.sig_hex;

  // If we got an object that has 'signature' inside (double nesting)
  if (signatureInput && typeof signatureInput === 'object' && signatureInput.signature) {
    signatureInput = signatureInput.signature;
  }

  if (!publicKeyInput || !signatureInput || !message) {
    console.warn('[Verification] Missing required signature components');
    logFail('Missing components', { publicKeyInput, signatureInput, hasMessage: !!message });
    return false;
  }

  const publicKeyStr = typeof publicKeyInput === 'string' ? publicKeyInput.trim() : publicKeyInput;
  const signatureStr = typeof signatureInput === 'string' ? signatureInput.trim() : signatureInput;

  // Parse message for timestamp/nonce if it's JSON
  let signedAt: number | null = null;
  try {
    if (typeof message === 'string') {
      let jsonStr = '';
      if (message.startsWith('{')) {
        jsonStr = message;
      } else {
        // Look for a JSON block inside the message (AIP-44 formatted message)
        const firstBrace = message.indexOf('{');
        const lastBrace = message.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = message.substring(firstBrace, lastBrace + 1);
        }
      }

      if (jsonStr) {
        const msgObj = JSON.parse(jsonStr);
        if (msgObj?.issuedAt) {
          signedAt = new Date(msgObj.issuedAt).getTime();
        }
      }

      if (!signedAt) {
        // Look for "Timestamp: 2026-05-08T..."
        const match = message.match(/Timestamp:\s*([^\n]+)/);
        if (match && match[1]) {
          const parsedDate = new Date(match[1].trim());
          if (!isNaN(parsedDate.getTime())) {
            signedAt = parsedDate.getTime();
          }
        }
      }
    }
  } catch (err: any) {
    // Ignore parse error on message, treat as raw string
  }

  // Strict Timestamp Check (Replay Protection Layer 1)
  if (maxAgeMinutes && signedAt) {
    const now = Date.now();
    const ageMs = now - signedAt;

    console.log(`[Verification] Message timestamp: ${new Date(signedAt).toISOString()}, Server time: ${new Date(now).toISOString()}, Age: ${ageMs}ms`);

    // Allow 1 minute buffer for clock drift (negative age)
    if (ageMs < -60000 || ageMs > maxAgeMinutes * 60 * 1000) {
      console.warn(`[Verification] Timestamp expired or too far in future: ageMs=${ageMs}`);
      logFail('Timestamp validation failed', { ageMs, signedAt, now });
      return false;
    }
  } else if (maxAgeMinutes) {
    console.warn('[Verification] No timestamp found in message for expiry check');
  }

  try {
    // Ensure we have strings for the SDK
    const finalizeHex = (val: unknown): string => {
      if (typeof val === 'string') return val.trim();
      if (val instanceof Uint8Array || (val && typeof val === 'object' && (val as { constructor?: { name?: string } }).constructor?.name === 'Uint8Array')) {
        return Array.from(val as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      if (val && typeof val === 'object') {
        const record = val as Record<string, number>;
        const keys = Object.keys(record).filter(k => !isNaN(Number(k)));
        if (keys.length > 0) {
          const arr = new Uint8Array(keys.length);
          keys.forEach(k => { arr[Number(k)] = record[k]; });
          return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        }
      }
      return String(val || '').trim();
    };

    const finalPublicKey = finalizeHex(publicKeyStr);
    const finalSignature = finalizeHex(signatureStr);

    console.log('[Verification] Final strings:', {
      publicKey: finalPublicKey.slice(0, 10) + '...',
      signature: finalSignature.slice(0, 10) + '...',
      messageType: typeof message
    });

    const publicKey = new Ed25519PublicKey(finalPublicKey);
    const aptosSignature = new Ed25519Signature(finalSignature);

    const verified = publicKey.verifySignature({
      message: new TextEncoder().encode(String(message)),
      signature: aptosSignature,
    });

    if (!verified) {
      console.warn('[Verification] Ed25519 verifySignature returned false');
      logFail('Ed25519 verification false', { finalPublicKey, finalSignature });
      return false;
    }

    const derivedAddress = normalizeAddress(String(publicKey.authKey().derivedAddress()));
    const normalizedWalletAddr = normalizeAddress(walletAddress);

    const match = derivedAddress === normalizedWalletAddr;
    if (!match) {
      console.warn(`[Verification] Address mismatch: Derived=${derivedAddress}, Requested=${normalizedWalletAddr}`);
      logFail('Address mismatch', { derivedAddress, normalizedWalletAddr });
    }

    return match;
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[Verification] Crypto error:', error.message, '| Stack:', error.stack);
    logFail('Crypto error', { error: error.message, stack: error.stack });
    return false;
  }
};

