import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';

const METHODS = ['GET', 'OPTIONS'];

const getMosaicApiUrl = () => {
  const explicit = String(process.env.MOSAIC_API_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const legacy = String(process.env.VITE_MOSAIC_API_URL || '').trim();
  if (legacy) return legacy.replace(/\/$/, '');

  return 'https://api.mosaic.ag/v1';
};

const getMosaicApiKey = () => {
  const key = String(process.env.MOSAIC_API_KEY || '').trim();
  if (key) return key;

  // Backward compatibility while migrating from frontend env.
  return String(process.env.VITE_MOSAIC_API_KEY || '').trim();
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `swap:tokens:read:${ip}`,
    limit: Number(process.env.SWAP_READ_RATE_LIMIT || 180),
    windowMs: Number(process.env.SWAP_READ_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const headers = { Accept: 'application/json' };
  const mosaicApiKey = getMosaicApiKey();
  if (mosaicApiKey) {
    headers['X-API-Key'] = mosaicApiKey;
  }

  try {
    const response = await fetch(`${getMosaicApiUrl()}/tokens`, {
      method: 'GET',
      headers,
    });

    const body = await response.text();
    if (!response.ok) {
      return sendJson(res, response.status, {
        error: `Mosaic tokens failed (${response.status})`,
        body: body.slice(0, 400),
      });
    }

    try {
      const parsed = JSON.parse(body);
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return sendJson(res, 200, parsed);
    } catch {
      return sendJson(res, 502, { error: 'Mosaic returned invalid JSON' });
    }
  } catch (error) {
    return sendJson(res, 502, {
      error: 'Failed to fetch tokens from Mosaic',
      reason: String(error?.message || 'unknown').slice(0, 240),
    });
  }
}
