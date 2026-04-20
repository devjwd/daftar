import { enforceRateLimit } from './_lib/rateLimit.js';
import { getClientIp, handleOptions, methodNotAllowed, sendJson, setApiHeaders } from './_lib/http.js';

const METHODS = ['GET', 'OPTIONS'];

const COINGECKO_IDS = {
  '0xa': 'movement',
  '0x1': 'movement',
  '0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d': 'tether',
  '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39': 'usd-coin',
  '0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650': 'usd-coin',
  '0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c': 'ethena-usde',
  '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376': 'ethereum',
  '0xe956f5062c3b9cba00e82dc775d29acf739ffa1e612e619062423b58afdbf035': 'wrapped-eeth',
  '0x2f6af255328fe11b88d840d1e367e946ccd16bd7ebddd6ee7e2ef9f7ae0c53ef': 'renzo-restaked-eth',
  '0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d': 'kelp-dao-restaked-eth',
  '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c': 'bitcoin',
  '0x0658f4ef6f76c8eeffdc06a30946f3f06723a7f9532e2413312b2a612183759c': 'lombard-staked-btc',
  '0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d': 'solv-protocol-solvbtc',
};

const FALLBACK_PRICES = {
  '0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d': 1.0,
  '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39': 1.0,
  '0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650': 1.0,
  '0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c': 1.0,
  '0x967d9125a338c5b1e22b6aacaa8d14b2b8b785ca44b614803ecbcdb4898229f3': 0,
  '0xf02c83698b28a544197858c4808b96ff740aa1c01b2f04ba33e80a485b4bf67a': 0,
};

const SERVER_CACHE_TTL_MS = 30_000;
const UPSTREAM_TIMEOUT_MS = 4_500;

let cachedSnapshot = {
  prices: { ...FALLBACK_PRICES },
  priceChanges: {},
  updatedAt: 0,
};

const getCoinGeckoApiUrl = () => {
  const ids = Array.from(new Set(Object.values(COINGECKO_IDS))).join(',');
  return `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchCoinGeckoPrices = async () => {
  const headers = {
    Accept: 'application/json',
  };

  const apiKey = String(process.env.COINGECKO_API_KEY || process.env.VITE_COINGECKO_API_KEY || '').trim();
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const response = await fetchWithTimeout(getCoinGeckoApiUrl(), { method: 'GET', headers });

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const prices = { ...FALLBACK_PRICES };
  const priceChanges = {};

  Object.entries(COINGECKO_IDS).forEach(([address, geckoId]) => {
    const usd = data?.[geckoId]?.usd;
    if (usd === undefined || usd === null) return;

    prices[address] = usd;

    const change = data?.[geckoId]?.usd_24h_change;
    if (change !== undefined && change !== null) {
      priceChanges[address] = change;
    }
  });

  return { prices, priceChanges };
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  const ip = getClientIp(req);
  const limiter = enforceRateLimit({
    key: `prices:read:${ip}`,
    limit: Number(process.env.PRICES_READ_RATE_LIMIT || 240),
    windowMs: Number(process.env.PRICES_READ_RATE_WINDOW_MS || 60_000),
  });

  if (!limiter.ok) {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
    return sendJson(res, 429, { error: 'Too many requests' });
  }

  const now = Date.now();
  if (cachedSnapshot.updatedAt && now - cachedSnapshot.updatedAt < SERVER_CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=120');
    return sendJson(res, 200, {
      prices: cachedSnapshot.prices,
      priceChanges: cachedSnapshot.priceChanges,
      updatedAt: cachedSnapshot.updatedAt,
      stale: false,
      source: 'memory-cache',
    });
  }

  try {
    const live = await fetchCoinGeckoPrices();
    cachedSnapshot = {
      prices: {
        ...cachedSnapshot.prices,
        ...live.prices,
      },
      priceChanges: live.priceChanges,
      updatedAt: now,
    };

    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=120');
    return sendJson(res, 200, {
      prices: cachedSnapshot.prices,
      priceChanges: cachedSnapshot.priceChanges,
      updatedAt: cachedSnapshot.updatedAt,
      stale: false,
      source: 'coingecko',
    });
  } catch (error) {
    const hasCache = Boolean(cachedSnapshot.updatedAt);
    const fallbackPayload = {
      prices: cachedSnapshot.prices,
      priceChanges: cachedSnapshot.priceChanges,
      updatedAt: cachedSnapshot.updatedAt || now,
      stale: true,
      source: hasCache ? 'stale-memory-cache' : 'fallback-prices',
      warning: String(error?.message || 'Failed to refresh prices').slice(0, 240),
    };

    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=120');
    return sendJson(res, 200, fallbackPayload);
  }
}