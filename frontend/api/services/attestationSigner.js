import { createHash } from 'node:crypto';
import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

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
  const privateKeyHex = normalizePrivateKey(process.env.BADGE_ATTESTOR_PRIVATE_KEY || '');
  if (!privateKeyHex) {
    return { ok: false, error: 'BADGE_ATTESTOR_PRIVATE_KEY is missing' };
  }

  try {
    const privateKey = new Ed25519PrivateKey(privateKeyHex);
    const account = Account.fromPrivateKey({ privateKey });
    const expectedAddress = normalizeAddress(process.env.BADGE_ATTESTOR_ADDRESS || '');
    const actualAddress = String(account.accountAddress).toLowerCase();

    if (expectedAddress && expectedAddress !== actualAddress) {
      return { ok: false, error: 'BADGE_ATTESTOR_ADDRESS does not match BADGE_ATTESTOR_PRIVATE_KEY' };
    }

    return { ok: true, account, attestorAddress: actualAddress };
  } catch {
    return { ok: false, error: 'Invalid BADGE_ATTESTOR_PRIVATE_KEY format' };
  }
};

export const createAttestation = ({ walletAddress, badgeId, ttlMinutes = 24 * 60 }) => {
  const attestor = getAttestorAccount();
  if (!attestor.ok) {
    return { ok: false, error: attestor.error };
  }

  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Number(ttlMinutes || 0) * 60_000).toISOString();
  const message = `daftar.badge.eligibility:v1:${walletAddress}:${badgeId}:${issuedAt}:${expiresAt}`;

  try {
    const signature = attestor.account.sign(textEncoder.encode(message));
    const signatureHex = Buffer.from(signature.toUint8Array()).toString('hex');
    const proofHash = createHash('sha256').update(`${message}:${signatureHex}`).digest('hex');

    return {
      ok: true,
      attestation: {
        walletAddress,
        badgeId,
        issuedAt,
        expiresAt,
        message,
        signature: signatureHex,
        attestorAddress: attestor.attestorAddress,
        proofHash,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || 'Failed to create attestation signature').slice(0, 240),
    };
  }
};

export default {
  createAttestation,
};
