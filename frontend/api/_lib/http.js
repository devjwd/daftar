const DEFAULT_ALLOWED_METHODS = ['GET', 'POST', 'DELETE', 'OPTIONS'];
const SENSITIVE_RESPONSE_KEYS = new Set(['privatekey', 'private_key', 'signingkey', 'secretkey']);

const splitCsv = (value) =>
  String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const getAllowedOrigins = () => {
  const env =
    process.env.PROFILE_CORS_ORIGIN ||
    process.env.API_CORS_ORIGIN ||
    process.env.BADGE_CORS_ORIGIN ||
    '';

  const list = splitCsv(env);
  if (list.length === 0) {
    const defaults = ['http://localhost:5173', 'http://localhost:3000'];
    const vercelProd = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
    const vercelPreview = String(process.env.VERCEL_URL || '').trim();

    if (vercelProd) defaults.unshift(`https://${vercelProd.replace(/^https?:\/\//, '')}`);
    if (vercelPreview) defaults.unshift(`https://${vercelPreview.replace(/^https?:\/\//, '')}`);

    return [...new Set(defaults)];
  }
  return list;
};

const getHeaderValue = (value) => {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() : '';
  }

  return typeof value === 'string' ? value.trim() : '';
};

const getForwardedIp = (value) => getHeaderValue(value).split(',')[0]?.trim() || '';

const shouldTrustProxyHeaders = () => {
  const explicit = String(process.env.TRUST_PROXY_HEADERS || '').trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return Boolean(process.env.VERCEL);
};

export const getClientIp = (req) => {
  const socketIp = getHeaderValue(req.socket?.remoteAddress || req.connection?.remoteAddress);
  if (!shouldTrustProxyHeaders()) {
    return socketIp || 'unknown';
  }

  return (
    getForwardedIp(req.headers['x-forwarded-for']) ||
    getHeaderValue(req.headers['x-real-ip']) ||
    socketIp ||
    'unknown'
  );
};

export const setApiHeaders = (req, res, methods = DEFAULT_ALLOWED_METHODS) => {
  const allowedOrigins = getAllowedOrigins();
  const requestOrigin = req.headers.origin;
  const origin = requestOrigin
    ? allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : 'null'
    : allowedOrigins[0] || 'null';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-profile-edit-key, x-profile-address, x-profile-public-key, x-profile-signature, x-profile-message-b64, x-profile-full-message-b64, Authorization'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
};

export const handleOptions = (req, res, methods = DEFAULT_ALLOWED_METHODS) => {
  setApiHeaders(req, res, methods);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
};

const stripSensitiveFields = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripSensitiveFields);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (SENSITIVE_RESPONSE_KEYS.has(String(key).toLowerCase())) {
      continue;
    }
    sanitized[key] = stripSensitiveFields(entryValue);
  }

  return sanitized;
};

export const sendJson = (res, status, payload) => res.status(status).json(stripSensitiveFields(payload));

export const methodNotAllowed = (res, method, methods = DEFAULT_ALLOWED_METHODS) =>
  sendJson(res, 405, {
    error: `Method ${method} not allowed`,
    allowedMethods: methods.filter((m) => m !== 'OPTIONS'),
  });
