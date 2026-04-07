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
  if (list.length === 0) return ['*'];
  return list;
};

export const getClientIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }

  return (
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown'
  );
};

export const setApiHeaders = (req, res, methods = DEFAULT_ALLOWED_METHODS) => {
  const allowedOrigins = getAllowedOrigins();
  const requestOrigin = req.headers.origin;
  const wildcard = allowedOrigins.includes('*');

  const origin = wildcard
    ? '*'
    : allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[0];

  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-profile-edit-key, x-admin-key, Authorization');
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
