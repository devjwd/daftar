import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from '../_lib/http.js';

const METHODS = ['GET', 'OPTIONS'];
const ADDRESS_PATTERN = /^0x[a-f0-9]{1,64}$/i;
const AMOUNT_PATTERN = /^\d+$/;
const SOURCE_PATTERN = /^[a-z0-9_]+$/i;

const NETWORKS = {
  mainnet: 'https://mainnet.movementnetwork.xyz/v1',
  testnet: 'https://testnet.movementnetwork.xyz/v1',
};

const normalizeAddress = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const decodeMoveString = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') {
    if (!value.startsWith('0x')) return value;
    const hex = value.slice(2);
    let output = '';
    for (let i = 0; i < hex.length; i += 2) {
      const code = Number.parseInt(hex.slice(i, i + 2), 16);
      if (!Number.isNaN(code)) output += String.fromCharCode(code);
    }
    return output;
  }
  if (Array.isArray(value)) {
    return new TextDecoder().decode(new Uint8Array(value));
  }
  return String(value);
};

const getMosaicApiUrl = () => {
  const explicit = String(process.env.MOSAIC_API_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  return 'https://api.mosaic.ag/v1';
};

const getMosaicApiKey = () => {
  const key = String(process.env.MOSAIC_API_KEY || '').trim();
  return key;
};

const getFullnodeUrl = () => {
  const explicit = String(
    process.env.MOVEMENT_RPC_URL ||
    process.env.VITE_MOVEMENT_RPC_URL ||
    ''
  ).trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const network = String(process.env.VITE_NETWORK || process.env.NETWORK || 'mainnet').toLowerCase();
  return network === 'testnet' ? NETWORKS.testnet : NETWORKS.mainnet;
};

const getSwapRouterAddress = () => {
  const raw = String(process.env.SWAP_ROUTER_ADDRESS || process.env.VITE_SWAP_ROUTER_ADDRESS || '').trim();
  return normalizeAddress(raw);
};

const fetchRouterPartnerConfig = async () => {
  const routerAddress = getSwapRouterAddress();
  if (!routerAddress) {
    return { ok: true, config: null };
  }

  if (!ADDRESS_PATTERN.test(routerAddress)) {
    return { ok: false, error: 'Server missing valid swap router address' };
  }

  try {
    const response = await fetch(`${getFullnodeUrl()}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function: `${routerAddress}::router::get_partner_config`,
        type_arguments: [],
        arguments: [],
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      return { ok: false, error: `Failed to load router config (${response.status})` };
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false, error: 'Router config returned invalid JSON' };
    }

    if (!Array.isArray(parsed) || parsed.length < 5) {
      return { ok: false, error: 'Router config response shape is invalid' };
    }

    const [feeInBpsRaw, feeReceiverRaw, chargeFeeByRaw, defaultSlippageBpsRaw, pausedRaw] = parsed;
    const chargeFeeBy = decodeMoveString(chargeFeeByRaw).trim().toLowerCase() === 'token_out'
      ? 'token_out'
      : 'token_in';
    const feeReceiver = normalizeAddress(feeReceiverRaw);
    const feeInBps = Math.max(0, Math.min(500, Number(feeInBpsRaw) || 0));

    if (feeInBps > 0 && !ADDRESS_PATTERN.test(feeReceiver)) {
      return { ok: false, error: 'Router fee receiver is invalid' };
    }

    return {
      ok: true,
      config: {
        feeInBps,
        feeReceiver,
        chargeFeeBy,
        isFeeIn: chargeFeeBy === 'token_in',
        defaultSlippageBps: Number(defaultSlippageBpsRaw) || 0,
        paused: Boolean(pausedRaw),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to load router config: ${String(error?.message || error).slice(0, 240)}`,
    };
  }
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

  const routerConfigResult = await fetchRouterPartnerConfig();
  if (!routerConfigResult.ok) {
    return sendJson(res, 503, { error: routerConfigResult.error });
  }

  const routerConfig = routerConfigResult.config;
  validated.params.delete('feeInBps');
  validated.params.delete('chargeFeeBy');
  validated.params.delete('isFeeIn');
  validated.params.delete('feeReceiver');

  if (routerConfig?.paused) {
    return sendJson(res, 503, { error: 'Swap router is paused' });
  }

  if (routerConfig && routerConfig.feeInBps > 0) {
    validated.params.set('feeInBps', String(routerConfig.feeInBps));
    validated.params.set('chargeFeeBy', routerConfig.chargeFeeBy);
    validated.params.set('isFeeIn', String(routerConfig.isFeeIn));
    validated.params.set('feeReceiver', routerConfig.feeReceiver);
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
