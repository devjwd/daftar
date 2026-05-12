import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';
import CONFIG from '../config/index.ts';

// Mapping of Movement tokens to CoinGecko IDs
const TOKEN_GEKO_MAP: Record<string, string> = {
  '0x1::aptos_coin::AptosCoin': 'aptos',
  '0x1::move_coin::MoveCoin': 'movement', // Hypothetical ID, adjust if different
  '0x2775ca060ee29c793f64c419623d24cd5d4833d7::usdc::USDC': 'usd-coin',
  '0x399b9e77605e54452140d3a51f7b8d80f8641951::weth::WETH': 'ethereum',
  '0x123...': 'tether' // Add more as needed
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
      // If price not found, we might want to skip or try later
      // For now, let's just mark as processed to avoid infinite loops, or keep false to retry
    }

    // Small delay to avoid CG rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
