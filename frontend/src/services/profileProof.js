const normalizeHex = (value = '') => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const normalizeAddress = (value = '') => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const prefixed = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-f]+$/i.test(prefixed)) return '';
  const compact = prefixed.replace(/^0+/, '') || '0';
  return `0x${compact}`;
};

const encodeBase64 = (value) => {
  const bytes = new TextEncoder().encode(String(value || ''));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const stableStringify = (value) => {
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

const sha256Hex = async (value) => {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const randomNonce = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const resolveAccountAddress = (account) => normalizeAddress(
  typeof account?.address === 'string' ? account.address : account?.address?.toString?.() || ''
);

const resolveAccountPublicKey = (account) => normalizeHex(
  typeof account?.publicKey === 'string' ? account.publicKey : account?.publicKey?.toString?.() || ''
);

export const createProfileMigrationProofHeaders = async ({ account, signMessage, action, body, address }) => {
  if (typeof signMessage !== 'function') {
    throw new Error('Connected wallet does not support message signing');
  }

  const accountAddress = resolveAccountAddress(account);
  const proofAddress = normalizeAddress(address);
  const publicKey = resolveAccountPublicKey(account);

  if (!accountAddress || !publicKey || !proofAddress) {
    throw new Error('Wallet address and public key are required');
  }

  if (accountAddress !== proofAddress) {
    throw new Error('Connected wallet must match the profile address');
  }

  const nonce = randomNonce();
  const issuedAt = new Date().toISOString();
  const bodyHash = await sha256Hex(stableStringify(body || {}));
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : 'unknown';
  const message = JSON.stringify({ action, address: proofAddress, bodyHash, issuedAt, nonce, origin });

  const response = await signMessage({
    address: true,
    application: true,
    chainId: true,
    message,
    nonce,
  });

  if (!response || Array.isArray(response.signature) || !response.signature) {
    throw new Error('Wallet returned an unsupported signature format');
  }

  return {
    'x-profile-address': proofAddress,
    'x-profile-public-key': publicKey,
    'x-profile-signature': normalizeHex(response.signature),
    'x-profile-message-b64': encodeBase64(response.message || message),
    'x-profile-full-message-b64': encodeBase64(response.fullMessage || ''),
  };
};