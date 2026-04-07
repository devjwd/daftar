import { createHash } from 'node:crypto';
import { getValidatedAttestorAccount } from '../badges/attestorConfig.js';

const textEncoder = new TextEncoder();

export const createAttestation = ({ walletAddress, badgeId, ttlMinutes = 24 * 60 }) => {
  let attestor;
  try {
    attestor = getValidatedAttestorAccount();
  } catch (error) {
    return { ok: false, error: String(error?.message || 'Attestor account unavailable') };
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
