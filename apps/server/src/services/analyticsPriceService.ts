import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';
import CONFIG from '../config/index.ts';
import { APTOS_COIN_PATTERNS } from '../config/whitelists.ts';

/**
 * Normalizes a token address to its canonical form, mapping any AptosCoin patterns to '0x1'.
 */
function normalizeTokenAddress(addr: string): string {
  if (!addr) return '';
  const lower = addr.toLowerCase();
  if (APTOS_COIN_PATTERNS.some(p => lower.includes(p))) {
    return '0x1';
  }
  return addr.replace(/^0x0*/, '0x');
}

// Mapping of Movement tokens to CoinGecko IDs
const TOKEN_GEKO_MAP: Record<string, string> = {
  // Native & Core
  '0x1': 'movement',
  '0xa': 'movement',
  
  // Stablecoins
  '0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d': 'tether',
  '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39': 'usd-coin',
  '0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e': 'usd-coin',
  '0x9d146a4c9472a7e7b0dbc72da0eafb02b54173a956ef22a9fba29756f8661c6c': 'ethena-usde',
  
  // Assets
  '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376': 'ethereum',
  '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c': 'bitcoin',
  
  // LSTs & Restaked
  '0x2f6af255328fe11b88d840d1e367e946ccd16bd7ebddd6ee7e2ef9f7ae0c53ef': 'renzo-restaked-eth',
  '0x51ffc9885233adf3dd411078cad57535ed1982013dc82d9d6c433a55f2e0035d': 'kelp-dao-restaked-eth',
  '0xe956f5062c3b9cba00e82dc775d29acf739ffa1e612e619062423b58afdbf035': 'wrapped-eeth',
  '0x527c43638a6c389a9ad702e7085f31c48223624d5102a5207dfab861f482c46d': 'solv-btc'
};

/**
 * Full fungible asset addresses for tokens that use short aliases (0x1, 0xa).
 * DexScreener cannot query short addresses, so we map them here.
 */
const DEXSCREENER_FULL_ADDRESSES: Record<string, string> = {
  // MOVE native token on Movement Network Mainnet
  '0x1': '0x000000000000000000000000000000000000000000000000000000000000000a',
  '0xa': '0x000000000000000000000000000000000000000000000000000000000000000a',
};

/**
 * Fetch a price for a specific date from CoinGecko.
 * Supports demo keys (CG-xxx → demo-api.coingecko.com) and pro keys.
 * Date format for CG: dd-mm-yyyy
 */
async function fetchHistoricalPriceFromCG(geckoId: string, timestamp: string): Promise<number | null> {
  const date = new Date(timestamp);
  const dateStr = `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;

  const apiKey = String(process.env.COINGECKO_API_KEY || '').trim();
  const isDemoKey = apiKey.startsWith('CG-');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    if (isDemoKey) headers['x-cg-demo-api-key'] = apiKey;
    else headers['x-cg-pro-api-key'] = apiKey;
  }

  // Try demo endpoint first (for demo keys), then standard
  const bases = isDemoKey
    ? ['https://demo-api.coingecko.com', 'https://api.coingecko.com']
    : ['https://api.coingecko.com'];

  for (const base of bases) {
    const url = `${base}/api/v3/coins/${geckoId}/history?date=${dateStr}&localization=false`;
    try {
      const requestHeaders = base.includes('demo-api.coingecko.com')
        ? headers
        : (isDemoKey ? { Accept: 'application/json' } : headers);
      const response = await fetch(url, { headers: requestHeaders });
      if (!response.ok) {
        console.warn(`[PriceBackfill] CoinGecko ${base} returned ${response.status} for ${geckoId} on ${dateStr}`);
        continue;
      }
      const json: any = await response.json();
      const price = json.market_data?.current_price?.usd;
      if (price != null) return price;
    } catch (err: any) {
      console.warn(`[PriceBackfill] CoinGecko ${base} unreachable: ${err.message}`);
    }
  }
  return null;
}

/**
 * Fetch a price from DexScreener.
 * Maps short addresses (0x1, 0xa) to their full FA address before querying.
 */
async function fetchPriceFromDexScreener(tokenAddress: string): Promise<number | null> {
  // Map short aliases to full addresses DexScreener can resolve
  const queryAddress = DEXSCREENER_FULL_ADDRESSES[tokenAddress] || tokenAddress;
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${queryAddress}`;
    const response = await fetch(url);
    const json: any = await response.json();
    
    if (json.pairs && json.pairs.length > 0) {
      // Get highest liquidity pair
      const bestPair = json.pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      return bestPair.priceUsd ? Number(bestPair.priceUsd) : null;
    }
    return null;
  } catch (err) {
    console.error(`[PriceBackfill] DexScreener Error for ${tokenAddress}:`, err);
    return null;
  }
}

/**
 * Get price from cache or fetch new one
 */
async function getHistoricalPrice(
  supabase: SupabaseClient, 
  tokenAddress: string, 
  timestamp: string,
  cacheMap: Record<string, number | null>
): Promise<number | null> {
  const normAddress = normalizeTokenAddress(tokenAddress);
  const geckoId = TOKEN_GEKO_MAP[normAddress];
  const dateOnly = new Date(timestamp).toISOString().split('T')[0];
  const cacheKey = `${normAddress}_${dateOnly}`;

  if (cacheKey in cacheMap) {
    return cacheMap[cacheKey];
  }

  // 1. Check our Cache Table
  const { data: cached } = await supabase
    .from('token_price_history')
    .select('price')
    .eq('token_address', normAddress)
    .gte('timestamp', `${dateOnly}T00:00:00Z`)
    .lte('timestamp', `${dateOnly}T23:59:59Z`)
    .limit(1)
    .single();

  if (cached) {
    const price = Number(cached.price);
    cacheMap[cacheKey] = price;
    return price;
  }

  // 2. Not in cache, fetch from CoinGecko
  let price = null;
  
  if (geckoId) {
    price = await fetchHistoricalPriceFromCG(geckoId, timestamp);
  }
  
  // 3. Fallback to DexScreener if CoinGecko failed or no geckoId
  if (!price) {
    console.log(`[PriceBackfill] Falling back to DexScreener for ${normAddress}`);
    price = await fetchPriceFromDexScreener(normAddress);
  }
  
  if (price) {
    // Save to cache for future use
    await supabase.from('token_price_history').insert({
      token_address: normAddress,
      price: price,
      timestamp: `${dateOnly}T12:00:00Z`, // Mid-day snapshot
      granularity: 'daily',
      source: geckoId && price ? 'coingecko' : 'dexscreener'
    });
  }

  cacheMap[cacheKey] = price;
  return price;
}

/**
 * Main worker function to process pending transactions
 */
export async function backfillTransactionPrices(supabase: SupabaseClient, limit: number = 20) {
  // 1. Get unprocessed transactions
  const { data: pending, error } = await supabase
    .from('user_transaction_history')
    .select('*')
    .eq('is_processed', false)
    .limit(limit);

  if (error || !pending || pending.length === 0) return;

  console.log(`[PriceBackfill] Processing ${pending.length} transactions...`);

  // Batch-level cache map to avoid duplicate DB checks for the same token + day
  const batchPriceCache: Record<string, number | null> = {};
  const updatedTxs: any[] = [];

  for (const tx of pending) {
    // Try to get price for the primary asset out or in
    let tokenToPriceOut = null;
    let tokenToPriceIn = null;
    const allFAs = tx.metadata?.fungible_asset_activities || [];
    const allCAs = tx.metadata?.coin_activities || [];

    if (tx.asset_out_symbol) {
      const matchedFA = allFAs.find((fa: any) => fa.metadata?.symbol === tx.asset_out_symbol);
      const matchedCA = allCAs.find((ca: any) => (ca.coin_type || '').includes(tx.asset_out_symbol?.toLowerCase() || ''));
      tokenToPriceOut = matchedFA?.asset_type || matchedCA?.coin_type || allFAs[0]?.asset_type || allCAs[0]?.coin_type;
    }
    
    if (tx.asset_in_symbol) {
      const matchedFA = allFAs.find((fa: any) => fa.metadata?.symbol === tx.asset_in_symbol);
      const matchedCA = allCAs.find((ca: any) => (ca.coin_type || '').includes(tx.asset_in_symbol?.toLowerCase() || ''));
      tokenToPriceIn = matchedFA?.asset_type || matchedCA?.coin_type || allFAs[0]?.asset_type || allCAs[0]?.coin_type;
    }
    
    // Calculate precise gas fee in USD based on actual historical MOVE price
    let finalGasUsd = 0.05;
    const gasUsed = tx.metadata?.gas_used;
    const gasUnitPrice = tx.metadata?.gas_unit_price;
    if (gasUsed != null && gasUnitPrice != null) {
      const gasNative = (Number(gasUsed) * Number(gasUnitPrice)) / 1e8;
      const movePrice = await getHistoricalPrice(supabase, '0x1', tx.timestamp, batchPriceCache) || 0.05;
      finalGasUsd = gasNative * movePrice;
    } else if (tx.gas_usd != null && Number(tx.gas_usd) < 0.1) {
      const movePrice = await getHistoricalPrice(supabase, '0x1', tx.timestamp, batchPriceCache) || 0.05;
      finalGasUsd = Number(tx.gas_usd) * movePrice;
    }

    if (!tokenToPriceOut && !tokenToPriceIn) {
      // If no assets to price (e.g. gas only), mark as processed
      tx.is_processed = true;
      tx.gas_usd = finalGasUsd;
      updatedTxs.push(tx);
      continue;
    }

    let price: number | null = null;
    let amount = 0;

    if (tokenToPriceOut) {
      price = await getHistoricalPrice(supabase, tokenToPriceOut, tx.timestamp, batchPriceCache);
      if (price) amount = tx.asset_out_amount;
    }

    if (!price && tokenToPriceIn) {
      price = await getHistoricalPrice(supabase, tokenToPriceIn, tx.timestamp, batchPriceCache);
      if (price) amount = tx.asset_in_amount;
    }
    
    // Fallback static prices for demo if CoinGecko rate limits
    if (!price) {
       const fallbackToken = tokenToPriceOut || tokenToPriceIn || '';
       amount = tx.asset_out_amount || tx.asset_in_amount || 0;
       
       if (fallbackToken.includes('aptos_coin') || fallbackToken === '0x1' || fallbackToken === '0xa') {
         price = 0.05; // Realistic MOVE price for demo/testnet
       } else if (fallbackToken.toLowerCase().includes('usd')) {
         price = 1.00;
       } else if (fallbackToken.toLowerCase().includes('eth')) {
         price = 3500.00;
       } else if (fallbackToken.toLowerCase().includes('btc')) {
         price = 65000.00;
       } else {
         price = 0; // Unknown token — don't assign phantom value
       }
    }
    
    if (price) {
      const totalValue = price * Number(amount);
      tx.price_usd = price;
      tx.value_usd = totalValue;
      tx.gas_usd = finalGasUsd;
      tx.is_processed = true;
    } else {
      const metadata = tx.metadata || {};
      const retryCount = Number(metadata.retry_count || 0);

      if (retryCount < 3) {
        tx.metadata = {
          ...metadata,
          retry_count: retryCount + 1
        };
      } else {
        tx.price_usd = 0;
        tx.value_usd = 0;
        tx.gas_usd = finalGasUsd;
        tx.is_processed = true;
      }
    }

    updatedTxs.push(tx);

    // Sleep 100ms to throttle external CoinGecko calls if it has to fall back
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Bulk update all processed transactions in a single query
  if (updatedTxs.length > 0) {
    const { error: upsertError } = await supabase
      .from('user_transaction_history')
      .upsert(updatedTxs);

    if (upsertError) {
      console.error('[PriceBackfill] Failed to bulk update transaction history:', upsertError.message);
    } else {
      console.log(`[PriceBackfill] ✅ Successfully bulk updated ${updatedTxs.length} transactions in 1 request.`);
    }
  }
}

/**
 * Maintenance function to fix inflated demo prices
 */
export async function reProcessSuspiciousPrices(supabase: SupabaseClient) {
  console.log('[PriceBackfill] 🛠️  Starting cleanup of suspicious prices...');
  
  // Find transactions with the old high fallbacks (8.50, 12.00, 5.00)
  const { data: targets, error } = await supabase
    .from('user_transaction_history')
    .select('*')
    .or('price_usd.eq.8.5,price_usd.eq.12.0,price_usd.eq.5.0');

  if (error || !targets || targets.length === 0) return;

  console.log(`[PriceBackfill] Found ${targets.length} transactions with suspicious prices.`);

  for (const tx of targets) {
    // Reset to unprocessed to let the main backfill function handle it with new logic
    await supabase.from('user_transaction_history').update({
      is_processed: false,
      price_usd: null,
      value_usd: null
    }).eq('id', tx.id);
  }
  
  console.log('[PriceBackfill] ✅ Suspicious prices reset for re-processing.');
}
