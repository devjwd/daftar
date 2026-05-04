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
  signature: any,
  maxAgeMinutes: number = 5
): boolean => {
  const parsed = parseSignaturePayload(signature);
  const publicKeyHex = String(parsed?.publicKey || parsed?.public_key || '').trim();
  const signatureHex = String(parsed?.signature || parsed?.sig || '').trim();

  if (!publicKeyHex || !signatureHex || !message) {
    return false;
  }

  // Parse message for timestamp/nonce if it's JSON
  let signedAt: number | null = null;
  try {
    const msgObj = typeof message === 'string' && message.startsWith('{') ? JSON.parse(message) : null;
    if (msgObj?.issuedAt) {
      signedAt = new Date(msgObj.issuedAt).getTime();
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
    const publicKey = new Ed25519PublicKey(publicKeyHex);
    const aptosSignature = new Ed25519Signature(signatureHex);
    const verified = publicKey.verifySignature({
      message: new TextEncoder().encode(String(message)),
      signature: aptosSignature,
    });

    if (!verified) {
      console.warn('[Verification] Ed25519 verifySignature returned false');
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
    console.error('[Verification] Crypto error:', err.message);
    return false;
  }
};

