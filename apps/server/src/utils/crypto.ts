import { Ed25519PublicKey, Ed25519Signature } from '@aptos-labs/ts-sdk';
import { normalizeAddress } from './address.ts';

export const parseSignaturePayload = (signature: any): any => {
  if (signature && typeof signature === 'object') return signature;
  if (typeof signature !== 'string') return null;
  try {
    return JSON.parse(signature);
  } catch {
    return null;
  }
};

export const verifyWalletSignature = (
  walletAddress: string,
  message: string,
  signaturePayload: any,
  maxAgeMinutes: number = 5
): boolean => {
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
    return false;
  }

  const publicKeyStr = typeof publicKeyInput === 'string' ? publicKeyInput.trim() : publicKeyInput;
  const signatureStr = typeof signatureInput === 'string' ? signatureInput.trim() : signatureInput;


  // Parse message for timestamp/nonce if it's JSON
  let signedAt: number | null = null;
  try {
    if (typeof message === 'string') {
      if (message.startsWith('{')) {
        const msgObj = JSON.parse(message);
        if (msgObj?.issuedAt) signedAt = new Date(msgObj.issuedAt).getTime();
      } else {
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
  } catch {
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
      return false;
    }
  } else if (maxAgeMinutes) {
    console.warn('[Verification] No timestamp found in message for expiry check');
  }

  try {
    // Ensure we have strings for the SDK
    const finalizeHex = (val: any): string => {
      if (typeof val === 'string') return val.trim();
      if (val instanceof Uint8Array || (val && typeof val === 'object' && val.constructor?.name === 'Uint8Array')) {
        return Array.from(val as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      if (val && typeof val === 'object') {
        // Handle indexed object {0: 1, 1: 2...} which can happen if JSON.stringified Uint8Array
        const keys = Object.keys(val).filter(k => !isNaN(Number(k)));
        if (keys.length > 0) {
          const arr = new Uint8Array(keys.length);
          keys.forEach(k => { arr[Number(k)] = val[k]; });
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
      // If it fails, try to see if it's because of the message prefix (some wallets sign differently)
      return false;
    }

    const derivedAddress = normalizeAddress(String(publicKey.authKey().derivedAddress()));
    const normalizedWalletAddr = normalizeAddress(walletAddress);

    const match = derivedAddress === normalizedWalletAddr;
    if (!match) {
      console.warn(`[Verification] Address mismatch: Derived=${derivedAddress}, Requested=${normalizedWalletAddr}`);
    }

    return match;
  } catch (err: any) {
    console.error('[Verification] Crypto error:', err.message, '| Stack:', err.stack);
    return false;
  }
};

