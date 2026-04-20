import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

// Module-level cache — re-derived only when env vars change (process restart).
let _cachedAttestor = null;
let _cachedPrivateKeyHex = null;

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

export const getValidatedAttestorAccount = () => {
  const rawPrivateKey = String(process.env.BADGE_ATTESTOR_PRIVATE_KEY || '').trim();
  const rawConfiguredAddress = String(process.env.BADGE_ATTESTOR_ADDRESS || '').trim();
  if (!rawPrivateKey || !rawConfiguredAddress) {
    throw new Error('Missing BADGE_ATTESTOR_PRIVATE_KEY or BADGE_ATTESTOR_ADDRESS');
  }

  const privateKeyHex = normalizePrivateKey(rawPrivateKey);
  const configuredAddress = normalizeAddress(rawConfiguredAddress);

  if (!privateKeyHex || !configuredAddress) {
    throw new Error('Missing BADGE_ATTESTOR_PRIVATE_KEY or BADGE_ATTESTOR_ADDRESS');
  }

  // Return cached result if the private key has not changed.
  if (_cachedAttestor && _cachedPrivateKeyHex === privateKeyHex) {
    return _cachedAttestor;
  }

  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const account = Account.fromPrivateKey({ privateKey });
  const attestorAddress = String(account.accountAddress).toLowerCase().trim();
  const normalizedConfigured = configuredAddress.toLowerCase().trim();

  if (attestorAddress !== normalizedConfigured) {
    throw new Error('FATAL: BADGE_ATTESTOR_PRIVATE_KEY does not match BADGE_ATTESTOR_ADDRESS');
  }

  _cachedPrivateKeyHex = privateKeyHex;
  _cachedAttestor = { account, attestorAddress };
  return _cachedAttestor;
};

export default getValidatedAttestorAccount;