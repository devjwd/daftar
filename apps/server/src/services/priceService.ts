import fetch from 'node-fetch';

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
  '0xa': 0.50,
  '0x1': 0.50,
};

const getCoinGeckoApiUrl = (): string => {
  const ids = Array.from(new Set(Object.values(TOKEN_COINGECKO_IDS))).join(',');
  return `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
};

export interface PriceSnapshot {
  prices: Record<string, number>;
  priceChanges: Record<string, number>;
}

export const fetchCoinGeckoPrices = async (): Promise<PriceSnapshot | null> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = String(process.env.COINGECKO_API_KEY || '').trim();
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  try {
    const response = await fetch(getCoinGeckoApiUrl(), {
      method: 'GET',
      headers
    });

    if (!response.ok) return null;
    const data: any = await response.json();

    const prices: Record<string, number> = { ...FALLBACK_PRICES };
    const priceChanges: Record<string, number> = {};

    Object.entries(TOKEN_COINGECKO_IDS).forEach(([address, geckoId]) => {
      const usd = data?.[geckoId]?.usd;
      if (usd != null) prices[address] = usd;
      const change = data?.[geckoId]?.usd_24h_change;
      if (change != null) priceChanges[address] = change;
    });

    return { prices, priceChanges };
  } catch (err: any) {
    console.error('[Prices] Fetch error:', err.message);
    return null;
  }
};

