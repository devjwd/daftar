import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';
import CONFIG from '../config/index.ts';

// Mapping of Movement tokens to CoinGecko IDs
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
 * Fetch a price for a specific date from CoinGecko
 * Date format for CG: dd-mm-yyyy
 */
async function fetchHistoricalPriceFromCG(geckoId: string, timestamp: string): Promise<number | null> {
  const date = new Date(timestamp);
  const dateStr = `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
  
  const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/history?date=${dateStr}&localization=false`;
  
  try {
    const response = await fetch(url);
    const json: any = await response.json();
    return json.market_data?.current_price?.usd || null;
  } catch (err) {
    console.error(`[PriceBackfill] CoinGecko Error for ${geckoId} on ${dateStr}:`, err);
    return null;
  }
}

/**
 * Fetch a price from DexScreener (current price, as historical is harder on DS without pro API, 
 * but better than static fallback for unknown tokens).
 */
async function fetchPriceFromDexScreener(tokenAddress: string): Promise<number | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
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
  timestamp: string
): Promise<number | null> {
  const geckoId = TOKEN_GEKO_MAP[tokenAddress];
  // We don't return null if !geckoId anymore, because we can try DexScreener

  // 1. Check our Cache Table
  const dateOnly = new Date(timestamp).toISOString().split('T')[0];
  const { data: cached } = await supabase
    .from('token_price_history')
    .select('price')
    .eq('token_address', tokenAddress)
    .gte('timestamp', `${dateOnly}T00:00:00Z`)
    .lte('timestamp', `${dateOnly}T23:59:59Z`)
    .limit(1)
    .single();

  if (cached) return Number(cached.price);

  // 2. Not in cache, fetch from CoinGecko
  let price = null;
  
  if (geckoId) {
    price = await fetchHistoricalPriceFromCG(geckoId, timestamp);
  }
  
  // 3. Fallback to DexScreener if CoinGecko failed or no geckoId
  if (!price) {
    console.log(`[PriceBackfill] Falling back to DexScreener for ${tokenAddress}`);
    price = await fetchPriceFromDexScreener(tokenAddress);
  }
  
  if (price) {
    // Save to cache for future use
    await supabase.from('token_price_history').insert({
      token_address: tokenAddress,
      price: price,
      timestamp: `${dateOnly}T12:00:00Z`, // Mid-day snapshot
      granularity: 'daily',
      source: geckoId && price ? 'coingecko' : 'dexscreener'
    });
  }

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

  for (const tx of pending) {
    // Try to get price for the primary asset out or in
    let tokenToPrice = null;
    if (tx.asset_out_symbol || tx.asset_in_symbol) {
      // Scan all activities to find the best matching token (not just the first, which may be gas)
      const allFAs = tx.metadata?.fungible_asset_activities || [];
      const allCAs = tx.metadata?.coin_activities || [];
      
      // Prefer an activity that matches the primary asset symbol
      const primarySymbol = tx.asset_out_symbol || tx.asset_in_symbol;
      const matchedFA = allFAs.find((fa: any) => {
        const sym = fa.metadata?.symbol || '';
        return sym === primarySymbol;
      });
      const matchedCA = allCAs.find((ca: any) => {
        const coinType = ca.coin_type || '';
        return coinType.includes(primarySymbol?.toLowerCase() || '');
      });
      
      tokenToPrice = matchedFA?.asset_type || matchedCA?.coin_type || allFAs[0]?.asset_type || allCAs[0]?.coin_type;
    }
    
    // Calculate precise gas fee in USD based on actual historical MOVE price
    let finalGasUsd = 0.05;
    const gasUsed = tx.metadata?.gas_used;
    const gasUnitPrice = tx.metadata?.gas_unit_price;
    if (gasUsed != null && gasUnitPrice != null) {
      const gasNative = (Number(gasUsed) * Number(gasUnitPrice)) / 1e8;
      const movePrice = await getHistoricalPrice(supabase, '0x1', tx.timestamp) || 0.05;
      finalGasUsd = gasNative * movePrice;
    } else if (tx.gas_usd != null && Number(tx.gas_usd) < 0.1) {
      const movePrice = await getHistoricalPrice(supabase, '0x1', tx.timestamp) || 0.05;
      finalGasUsd = Number(tx.gas_usd) * movePrice;
    }

    if (!tokenToPrice) {
      // If no assets to price (e.g. gas only), mark as processed
      await supabase.from('user_transaction_history').update({ 
        is_processed: true, 
        gas_usd: finalGasUsd 
      }).eq('id', tx.id);
      continue;
    }

    let price = await getHistoricalPrice(supabase, tokenToPrice, tx.timestamp);
    
    // Fallback static prices for demo if CoinGecko rate limits
    if (!price) {
       // On Movement, aptos_coin IS the native MOVE token
       if (tokenToPrice.includes('aptos_coin') || tokenToPrice === '0x1' || tokenToPrice === '0xa') {
         price = 0.05; // Realistic MOVE price for demo/testnet
       } else if (tokenToPrice.toLowerCase().includes('usd')) {
         price = 1.00;
       } else if (tokenToPrice.toLowerCase().includes('eth')) {
         price = 3500.00;
       } else if (tokenToPrice.toLowerCase().includes('btc')) {
         price = 65000.00;
       } else {
         price = 0; // Unknown token — don't assign phantom value
       }
    }
    
    if (price) {
      const amount = tx.asset_out_amount || tx.asset_in_amount || 0;
      const totalValue = price * Number(amount);

      await supabase.from('user_transaction_history').update({
        price_usd: price,
        value_usd: totalValue,
        gas_usd: finalGasUsd,
        is_processed: true
      }).eq('id', tx.id);
    } else {
      const metadata = tx.metadata || {};
      const retryCount = Number(metadata.retry_count || 0);

      if (retryCount < 3) {
        // Increment retry count and keep is_processed = false
        const updatedMetadata = {
          ...metadata,
          retry_count: retryCount + 1
        };
        await supabase.from('user_transaction_history').update({
          metadata: updatedMetadata
        }).eq('id', tx.id);
        console.log(`[PriceBackfill] Temporary pricing failure for ${tokenToPrice} on version ${tx.version}. Retrying later (Attempt ${retryCount + 1}/3)...`);
      } else {
        // Exceeded retries, mark as processed with a safe fallback of 0 (avoid -1 which inverts PNL charts)
        await supabase.from('user_transaction_history').update({
          price_usd: 0,
          value_usd: 0,
          gas_usd: finalGasUsd,
          is_processed: true
        }).eq('id', tx.id);
        console.warn(`[PriceBackfill] Failed to price ${tokenToPrice} on version ${tx.version} after 3 attempts. Storing fallback 0.`);
      }
    }

    // Increased delay to 2500ms to stay safely under CoinGecko's 30 calls/minute limit
    await new Promise(resolve => setTimeout(resolve, 2500));
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
