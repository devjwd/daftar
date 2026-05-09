import { normalizeAddress } from '../utils/address';

const normalizeHex = (value = '') => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
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

const resolveAccountAddress = (account) => {
  const raw = typeof account?.address === 'string' ? account.address : account?.address?.toString?.() || '';
  return normalizeAddress(raw);
};

const resolveAccountPublicKey = (account) => {
  const raw = typeof account?.publicKey === 'string' ? account.publicKey : account?.publicKey?.toString?.() || '';
  return normalizeHex(raw);
};

export const createAdminProofHeaders = async ({ account, signMessage, action, body }) => {
  if (typeof signMessage !== 'function') {
    throw new Error('Connected wallet does not support message signing');
  }

  const address = resolveAccountAddress(account);
  if (!address) {
    throw new Error('Admin wallet address is required');
  }

  const timestamp = Date.now();
  const nonce = randomNonce().slice(0, 8);
  const bodyHash = await sha256Hex(stableStringify(body || {}));
  
  // Format: "daftar-admin:${action}:${timestamp}:${nonce}:${jsonBodyHash}"
  const message = `daftar-admin:${action}:${timestamp}:${nonce}:${bodyHash}`;

  const response = await signMessage({
    address: true,
    application: true,
    chainId: true,
    message,
    nonce: String(timestamp),
  });

  if (!response || !response.signature) {
    throw new Error('Wallet returned an unsupported signature format');
  }

  // Handle both single signature and multi-sig array (take first)
  const signature = Array.isArray(response.signature) ? response.signature[0] : response.signature;
  const publicKey = resolveAccountPublicKey(account);

  return {
    'x-admin-address': address,
    'x-admin-public-key': publicKey,
    'x-admin-signature': normalizeHex(signature),
    'x-admin-timestamp': String(timestamp),
    'x-admin-nonce': nonce,
    'x-admin-action': action,
    'x-admin-message-b64': encodeBase64(message),
    'x-admin-full-message-b64': encodeBase64(response.fullMessage || ''),
  };
};
