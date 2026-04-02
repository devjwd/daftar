import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';

const METHODS = ['GET', 'OPTIONS'];
const ADDRESS_PATTERN = /^0x[a-f0-9]{1,64}$/i;
const AMOUNT_PATTERN = /^\d+$/;
const SOURCE_PATTERN = /^[a-z0-9_]+$/i;

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

const handleTokensRequest = async (req, res) => {
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
};

const validateQuery = (query) => {
  const srcAsset = String(query.srcAsset || '').trim().toLowerCase();
  const dstAsset = String(query.dstAsset || '').trim().toLowerCase();
  const amount = String(query.amount || '').trim();
  const sender = String(query.sender || '').trim().toLowerCase();
  const receiver = String(query.receiver || '').trim().toLowerCase();
  const slippage = String(query.slippage || '').trim();
  const source = String(query.source || '').trim().toLowerCase();

  if (!ADDRESS_PATTERN.test(srcAsset) || !ADDRESS_PATTERN.test(dstAsset)) {
    return { ok: false, error: 'srcAsset and dstAsset must be valid addresses' };
  }

  if (!AMOUNT_PATTERN.test(amount) || amount === '0') {
    return { ok: false, error: 'amount must be a positive integer string' };
  }

  if (!ADDRESS_PATTERN.test(sender) || !ADDRESS_PATTERN.test(receiver)) {
    return { ok: false, error: 'sender and receiver must be valid addresses' };
  }

  if (!/^\d+$/.test(slippage)) {
    return { ok: false, error: 'slippage must be an integer string (basis points)' };
  }

  const slippageValue = Number(slippage);
  if (!Number.isFinite(slippageValue) || slippageValue < 1 || slippageValue > 5000) {
    return { ok: false, error: 'slippage out of allowed range (1..5000 bps)' };
  }

  if (!SOURCE_PATTERN.test(source)) {
    return { ok: false, error: 'source is invalid' };
  }

  const next = new URLSearchParams({
    srcAsset,
    dstAsset,
    amount,
    sender,
    receiver,
    slippage,
    source,
  });

  const feeInBpsRaw = String(query.feeInBps || '').trim();
  if (feeInBpsRaw) {
    if (!/^\d+$/.test(feeInBpsRaw)) {
      return { ok: false, error: 'feeInBps must be an integer' };
    }
    const feeInBps = Number(feeInBpsRaw);
    if (!Number.isFinite(feeInBps) || feeInBps < 0 || feeInBps > 500) {
      return { ok: false, error: 'feeInBps out of allowed range (0..500)' };
    }
    next.set('feeInBps', String(feeInBps));

    const isFeeIn = String(query.isFeeIn || '').trim().toLowerCase();
    if (isFeeIn === 'true' || isFeeIn === 'false') {
      next.set('isFeeIn', isFeeIn);
    }

    const feeReceiver = String(query.feeReceiver || '').trim().toLowerCase();
    if (feeReceiver) {
      if (!ADDRESS_PATTERN.test(feeReceiver)) {
        return { ok: false, error: 'feeReceiver must be a valid address' };
      }
      next.set('feeReceiver', feeReceiver);
    }
  }

  return { ok: true, params: next };
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  if (String(req.query?.endpoint || '').trim().toLowerCase() === 'tokens') {
    return handleTokensRequest(req, res);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `swap:quote:read:${ip}`,
    limit: Number(process.env.SWAP_READ_RATE_LIMIT || 180),
    windowMs: Number(process.env.SWAP_READ_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const validated = validateQuery(req.query || {});
  if (!validated.ok) {
    return sendJson(res, 400, { error: validated.error });
  }

  const mosaicApiKey = getMosaicApiKey();
  if (!mosaicApiKey) {
    return sendJson(res, 503, { error: 'Server missing MOSAIC_API_KEY' });
  }

  const headers = {
    Accept: 'application/json',
    'X-API-Key': mosaicApiKey,
  };

  const url = `${getMosaicApiUrl()}/quote?${validated.params.toString()}`;

  try {
    const response = await fetch(url, { method: 'GET', headers });
    const body = await response.text();

    if (!response.ok) {
      return sendJson(res, response.status, {
        error: `Mosaic quote failed (${response.status})`,
        body: body.slice(0, 400),
      });
    }

    try {
      const parsed = JSON.parse(body);
      return sendJson(res, 200, parsed);
    } catch {
      return sendJson(res, 502, { error: 'Mosaic returned invalid JSON' });
    }
  } catch (error) {
    return sendJson(res, 502, {
      error: 'Failed to fetch quote from Mosaic',
      reason: String(error?.message || 'unknown').slice(0, 240),
    });
  }
}
