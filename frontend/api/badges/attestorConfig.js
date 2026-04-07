import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

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
  const privateKeyHex = normalizePrivateKey(process.env.BADGE_ATTESTOR_PRIVATE_KEY);
  const configuredAddress = normalizeAddress(process.env.BADGE_ATTESTOR_ADDRESS);

  if (!privateKeyHex || !configuredAddress) {
    throw new Error('FATAL: Missing BADGE_ATTESTOR_PRIVATE_KEY or BADGE_ATTESTOR_ADDRESS');
  }

  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const account = Account.fromPrivateKey({ privateKey });
  const attestorAddress = String(account.accountAddress).toLowerCase();

  if (attestorAddress !== configuredAddress) {
    throw new Error(
      'FATAL: BADGE_ATTESTOR_PRIVATE_KEY does not match BADGE_ATTESTOR_ADDRESS — verify your Vercel env vars'
    );
  }

  return { account, attestorAddress };
};

export default getValidatedAttestorAccount;