import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';

export const TOKEN_COINGECKO_IDS: Record<string, string> = {
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

export const FALLBACK_PRICES: Record<string, number> = {
  '0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d': 1.0,
  '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39': 1.0,
  '0x48b904a97eafd065ced05168ec44638a63e1e3bcaec49699f6b8dabbd1424650': 1.0,
  '0xa': 0.01806,
  '0x1': 0.01806,
  // BTC and ETH Fallbacks (May 2026)
  '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376': 2331.60, // WETH
  '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c': 81096.63, // WBTC
};

const getCoinGeckoApiUrl = (isDemo: boolean): string => {
  const ids = Array.from(new Set(Object.values(TOKEN_COINGECKO_IDS))).join(',');
  // Note: Coingecko Demo API also uses api.coingecko.com, but with different limits/headers
  const baseUrl = 'https://api.coingecko.com';
  return `${baseUrl}/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
};

export interface PriceSnapshot {
  prices: Record<string, number>;
  priceChanges: Record<string, number>;
}

export const fetchCoinGeckoPrices = async (supabase?: SupabaseClient | null): Promise<PriceSnapshot | null> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = String(process.env.COINGECKO_API_KEY || '').trim();
  const isDemoKey = apiKey.startsWith('CG-');

  if (apiKey) {
    if (isDemoKey) headers['x-cg-demo-api-key'] = apiKey;
    else headers['x-cg-pro-api-key'] = apiKey;
  }

  try {
    const response = await fetch(getCoinGeckoApiUrl(isDemoKey), {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      // If API fails, try to return latest from DB
      if (supabase) {
        const { data } = await supabase
          .from('price_cache')
          .select('token_id, price_usd, change_24h');

        if (data && data.length > 0) {
          const prices: Record<string, number> = {};
          const priceChanges: Record<string, number> = {};
          data.forEach((row: any) => {
            prices[row.token_id] = Number(row.price_usd);
            priceChanges[row.token_id] = Number(row.change_24h || 0);
          });
          return { prices, priceChanges };
        }
      }
      return null;
    }

    const data: any = await response.json();

    const prices: Record<string, number> = { ...FALLBACK_PRICES };
    const priceChanges: Record<string, number> = {};

    Object.entries(TOKEN_COINGECKO_IDS).forEach(([address, geckoId]) => {
      const usd = data?.[geckoId]?.usd;
      if (usd != null) prices[address] = usd;
      const change = data?.[geckoId]?.usd_24h_change;
      if (change != null) priceChanges[address] = change;
    });

    const snapshot = { prices, priceChanges };
    const now = new Date().toISOString();

    // Store in DB for persistence
    if (supabase) {
      // 1. Update Current Price Cache (for portfolio display)
      const cacheEntries = Object.entries(snapshot.prices).map(([token, price]) => ({
        token_id: token,
        price_usd: price,
        change_24h: snapshot.priceChanges[token] || 0,
        cached_at: now
      }));

      if (cacheEntries.length > 0) {
        await supabase
          .from('price_cache')
          .upsert(cacheEntries, { onConflict: 'token_id' });
      }

      // 2. Add to Historical Table (for PNL charts)
      // We only store specific high-value assets here to avoid DB bloat, or all if requested.
      // The user specifically mentioned MOVE, BTC, and ETH.
      const historyEntries = Object.entries(snapshot.prices)
        .filter(([addr]) => {
          // Filters for MOVE (0x1, 0xa), BTC, and ETH
          return addr === '0x1' || addr === '0xa' ||
            addr === '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c' ||
            addr === '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376';
        })
        .map(([addr, price]) => ({
          token_address: addr,
          price: price,
          timestamp: now,
          granularity: 'daily', // Using daily for the main history table
          source: 'coingecko'
        }));

      if (historyEntries.length > 0) {
        await supabase.from('token_price_history').insert(historyEntries);
      }
    }

    return snapshot;
  } catch (err: any) {
    console.error('[Prices] Fetch error:', err.message);
    return null;
  }
};

/**
 * Starts a background interval to "pitch" (fetch and store) prices every 5 minutes.
 * This ensures the database is always updated even without active requests.
 */
export const startPricePitcher = (supabase: SupabaseClient | null) => {
  const INTERVAL = 300000; // 5 minutes

  console.log('[Prices] Starting background price pitcher (5m interval)');

  // Initial pitch
  void fetchCoinGeckoPrices(supabase);

  return setInterval(() => {
    console.log('[Prices] Pitching new prices to database...');
    void fetchCoinGeckoPrices(supabase);
  }, INTERVAL);
};

