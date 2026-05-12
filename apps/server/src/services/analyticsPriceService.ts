import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';
import CONFIG from '../config/index.ts';

// Mapping of Movement tokens to CoinGecko IDs
// Mapping of Movement tokens to CoinGecko IDs
const TOKEN_GEKO_MAP: Record<string, string> = {
  // Native & Core
  '0x1::aptos_coin::AptosCoin': 'aptos',
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
 * Get price from cache or fetch new one
 */
async function getHistoricalPrice(
  supabase: SupabaseClient, 
  tokenAddress: string, 
  timestamp: string
): Promise<number | null> {
  const geckoId = TOKEN_GEKO_MAP[tokenAddress];
  if (!geckoId) return null;

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
  const price = await fetchHistoricalPriceFromCG(geckoId, timestamp);
  
  if (price) {
    // Save to cache for future use
    await supabase.from('token_price_history').insert({
      token_address: tokenAddress,
      price: price,
      timestamp: `${dateOnly}T12:00:00Z`, // Mid-day snapshot
      granularity: 'daily'
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
    const tokenToPrice = tx.asset_out_symbol ? tx.metadata?.fungible_asset_activities?.[0]?.asset_type : null;
    
    if (!tokenToPrice) {
      // If no assets to price (e.g. gas only), mark as processed
      await supabase.from('user_transaction_history').update({ is_processed: true }).eq('id', tx.id);
      continue;
    }

    const price = await getHistoricalPrice(supabase, tokenToPrice, tx.timestamp);
    
    if (price) {
      const amount = tx.asset_out_amount || tx.asset_in_amount || 0;
      const totalValue = price * Number(amount);

      await supabase.from('user_transaction_history').update({
        price_usd: price,
        value_usd: totalValue,
        is_processed: true
      }).eq('id', tx.id);
    } else {
      // Mark as processed with a failure flag (-1) to avoid infinite loop
      await supabase.from('user_transaction_history').update({
        price_usd: -1,
        value_usd: 0,
        is_processed: true
      }).eq('id', tx.id);
    }

    // Increased delay to 2500ms to stay safely under CoinGecko's 30 calls/minute limit
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
}
