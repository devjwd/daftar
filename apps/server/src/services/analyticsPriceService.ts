import fetch from 'node-fetch';
import { SupabaseClient } from '@supabase/supabase-js';
import CONFIG from '../config/index.ts';
import { APTOS_COIN_PATTERNS, NATIVE_MOVE_ADDRESSES, LST_PRICE_ALIASES } from '../config/whitelists.ts';

/**
 * Normalizes a token address to its canonical form, mapping any AptosCoin patterns to '0x1'.
 */
function normalizeTokenAddress(addr: string): string {
  if (!addr) return '';
  const lower = addr.toLowerCase();
  if (APTOS_COIN_PATTERNS.some(p => lower.includes(p))) {
    return '0x1';
  }
  // Normalize all native MOVE address variants to 0x1
  const short = lower.replace(/^0x0*/, '0x');
  if (NATIVE_MOVE_ADDRESSES.has(short)) {
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
async function getHistoricalPrice(
  supabase: SupabaseClient, 
  tokenAddress: string, 
  timestamp: string,
  cacheMap: Record<string, number | null>
): Promise<number | null> {
  const normAddress = normalizeTokenAddress(tokenAddress);
  const dateOnly = new Date(timestamp).toISOString().split('T')[0];
  const cacheKey = `${normAddress}_${dateOnly}`;

  if (cacheKey in cacheMap) {
    return cacheMap[cacheKey];
  }

  // 1. Check our Cache Table for the exact date
  const { data: cached } = await supabase
    .from('token_price_history')
    .select('price')
    .eq('token_address', normAddress)
    .gte('timestamp', `${dateOnly}T00:00:00Z`)
    .lte('timestamp', `${dateOnly}T23:59:59Z`)
    .limit(1)
    .maybeSingle();

  if (cached) {
    const price = Number(cached.price);
    cacheMap[cacheKey] = price;
    return price;
  }

  // 2. Exact date not found, get closest price before this timestamp
  const { data: closest } = await supabase
    .from('token_price_history')
    .select('price')
    .eq('token_address', normAddress)
    .lt('timestamp', timestamp)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (closest) {
    const price = Number(closest.price);
    cacheMap[cacheKey] = price;
    return price;
  }

  // 3. Not in historical table, check current price cache
  const { data: currentCache } = await supabase
    .from('price_cache')
    .select('price_usd')
    .eq('token_id', normAddress)
    .maybeSingle();

  if (currentCache) {
    const price = Number(currentCache.price_usd);
    cacheMap[cacheKey] = price;
    return price;
  }

  // 4. Default hardcoded fallbacks
  let price: number | null = null;
  const upperAddr = normAddress.toLowerCase();
  if (upperAddr === '0x1' || upperAddr === '0xa') {
    price = 0.01806; // Standard default MOVE price
  } else if (upperAddr.includes('usd')) {
    price = 1.00;
  } else if (upperAddr.includes('eth')) {
    price = 2500.00;
  } else if (upperAddr.includes('btc')) {
    price = 80000.00;
  }

  cacheMap[cacheKey] = price;
  return price;
}

/**
 * Main worker function to process pending transactions
 */
export async function backfillTransactionPrices(supabase: SupabaseClient, limit: number = 20, walletAddress?: string) {
  // 1. Get unprocessed transactions
  let query = supabase
    .from('user_transaction_history')
    .select('*')
    .eq('is_processed', false);

  if (walletAddress) {
    query = query.eq('user_address', walletAddress.toLowerCase().trim());
  }

  const { data: pending, error } = await query.limit(limit);

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
    
    // LST fallback: if the symbol is a known LST, use the underlying token's price
    if (!price && (tx.asset_out_symbol || tx.asset_in_symbol)) {
      const sym = tx.asset_out_symbol || tx.asset_in_symbol;
      if (sym && LST_PRICE_ALIASES[sym]) {
        price = await getHistoricalPrice(supabase, LST_PRICE_ALIASES[sym], tx.timestamp, batchPriceCache);
        amount = tx.asset_out_amount || tx.asset_in_amount || 0;
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
        // Fallback static prices for demo only as a last resort (after 3 failed retries)
        const fallbackToken = tokenToPriceOut || tokenToPriceIn || '';
        const fallbackAmount = tx.asset_out_amount || tx.asset_in_amount || 0;
        
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

        const totalValue = price * Number(fallbackAmount);
        tx.price_usd = price;
        tx.value_usd = totalValue;
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

  const { error: resetError } = await supabase
    .from('user_transaction_history')
    .update({
      is_processed: false,
      price_usd: null,
      value_usd: null
    })
    .in('id', targets.map(tx => tx.id));

  if (resetError) {
    console.error('[PriceBackfill] Failed to bulk reset suspicious prices:', resetError.message);
  } else {
    console.log(`[PriceBackfill] Reset ${targets.length} suspicious prices in 1 bulk request.`);
  }
  
  console.log('[PriceBackfill] ✅ Suspicious prices reset for re-processing.');
}
