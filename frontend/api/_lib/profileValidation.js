const ADDRESS_RE = /^0x[a-f0-9]{1,128}$/i;
const USERNAME_MAX = 50;
const BIO_MAX = 500;
const SOCIAL_MAX = 120;
const PFP_MAX = 600;
const SEARCH_MAX = 120;

const trimString = (value) => (typeof value === 'string' ? value.trim() : '');

const ensureMax = (value, max, label) => {
  if (value.length > max) {
    throw new Error(`${label} must be ${max} characters or less`);
  }
  return value;
};

const isHttpUrl = (value) => {
  if (!value) return true;
  if (value.startsWith('/')) return true;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const normalizeAddress = (address) => {
  const normalized = trimString(address).toLowerCase();
  if (!normalized) return '';
  const prefixed = normalized.startsWith('0x') ? normalized : `0x${normalized}`;
  return ADDRESS_RE.test(prefixed) ? prefixed : '';
};

export const sanitizeProfileInput = (payload = {}, current = {}) => {
  const username = ensureMax(trimString(payload.username || ''), USERNAME_MAX, 'Username');
  const bio = ensureMax(trimString(payload.bio || ''), BIO_MAX, 'Bio');
  const twitter = ensureMax(trimString(payload.twitter || ''), SOCIAL_MAX, 'Twitter');
  const telegram = ensureMax(trimString(payload.telegram || ''), SOCIAL_MAX, 'Telegram');
  const pfp = trimString(payload.pfp || '');

  if (pfp && !isHttpUrl(pfp)) {
    throw new Error('pfp must be an absolute http(s) URL or a root-relative path');
  }

  ensureMax(pfp, PFP_MAX, 'pfp');

  return {
    username,
    bio,
    twitter,
    telegram,
    pfp: pfp || null,
    createdAt: current.createdAt || payload.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const normalizeSearchQuery = (query) => {
  const value = trimString(query).toLowerCase();
  if (!value) return '';
  return ensureMax(value, SEARCH_MAX, 'Search query');
};

export const normalizeLimit = (raw, fallback = 20, max = 100) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.floor(n);
  if (int < 1) return 1;
  if (int > max) return max;
  return int;
};
