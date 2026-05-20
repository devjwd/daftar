/**
 * cleanAndBackfillPrices.ts
 *
 * This maintenance script:
 * 1. Removes all junk/scam/LP/AptosCoin token rows from user_balance_snapshots
 * 2. Removes cached Aptos prices from token_price_history and price_cache
 * 3. Fetches 1 year of real Movement ($MOVE) historical prices from CoinGecko
 * 4. Resets all transactions for re-pricing with correct MOVE prices
 * 5. Re-runs price backfilling
 * 6. Re-runs portfolio reconstruction for all wallets
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { backfillTransactionPrices } from '../services/analyticsPriceService.ts';
import { reconstructHistoricalBalances } from '../services/portfolioService.ts';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// === JUNK ASSET FILTERS ===
// These match the server-side isJunkAsset() logic in whitelists.ts

const JUNK_SYMBOLS = [
  'TEST', 'CAPY', 'MOVECAT',
  'MOVE Drops', 'MOVE Drop', 'MOVE Gift', 'MOVE Rwd', 'MOVEReward',
  'MOVEDrop', 'MOVEGift', 'MOVERwd', 'MOVEREWARD',
  'lMOVE', 'dMOVE',
];

const JUNK_ASSET_TYPE_PATTERNS = [
  '-LP', '_LP', '::LP', '::lp_',
  'LPToken', 'LpToken', 'lptoken',
  'liquidity_pool', 'LiquidityPool', 'pool_token',
  '::pair::', '::Pair::',
  '::aptos_coin::AptosCoin',
  '::aptos_coin::aptoscoin',
];

async function run() {
  console.log('🚀 Starting full clean and backfill script...');

  // ──────────────────────────────────────────────────────────────
  // STEP 1: Delete junk token rows from user_balance_snapshots
  // ──────────────────────────────────────────────────────────────
  console.log('\n🧹 Step 1: Removing junk/scam/LP/AptosCoin rows from user_balance_snapshots...');

  // 1a. Delete by blacklisted symbol
  for (const sym of JUNK_SYMBOLS) {
    const { error, count } = await supabase
      .from('user_balance_snapshots')
      .delete({ count: 'exact' })
      .eq('symbol', sym);
    if (error) console.error(`  ❌ Failed deleting symbol "${sym}":`, error.message);
    else if (count) console.log(`  ✅ Deleted ${count} rows with symbol "${sym}"`);
  }

  // 1b. Delete by asset_type patterns (LP tokens, AptosCoin type)
  for (const pattern of JUNK_ASSET_TYPE_PATTERNS) {
    const { error, count } = await supabase
      .from('user_balance_snapshots')
      .delete({ count: 'exact' })
      .ilike('asset_type', `%${pattern}%`);
    if (error) console.error(`  ❌ Failed deleting asset_type pattern "${pattern}":`, error.message);
    else if (count) console.log(`  ✅ Deleted ${count} rows matching asset_type pattern "${pattern}"`);
  }

  // 1c. Delete airdrop symbol patterns (MOVE Drop*, MOVE Gift*, etc.)
  const airdropPatterns = ['MOVE Drop%', 'MOVE Gift%', 'MOVE Rwd%', 'MOVEReward%', 'MOVE %'];
  for (const pat of airdropPatterns) {
    const { error, count } = await supabase
      .from('user_balance_snapshots')
      .delete({ count: 'exact' })
      .ilike('symbol', pat);
    if (error) console.error(`  ❌ Failed deleting airdrop pattern "${pat}":`, error.message);
    else if (count) console.log(`  ✅ Deleted ${count} rows matching symbol pattern "${pat}"`);
  }

  // Also clean balance and networth snapshots since they were calculated from junk data
  console.log('\n🧹 Clearing user_balance_snapshots for full reconstruction...');
  const { error: balDelErr } = await supabase
    .from('user_balance_snapshots')
    .delete()
    .neq('user_address', ''); // delete all for all users
  if (balDelErr) console.error('  ❌ Failed clearing balance snapshots:', balDelErr.message);
  else console.log('  ✅ Cleared all balance snapshots for full reconstruction');

  console.log('\n🧹 Clearing user_networth_snapshots for reconstruction...');
  const { error: nwErr } = await supabase
    .from('user_networth_snapshots')
    .delete()
    .neq('user_address', ''); // delete all
  if (nwErr) console.error('  ❌ Failed clearing networth snapshots:', nwErr.message);
  else console.log('  ✅ Cleared all networth snapshots for reconstruction');

  // ──────────────────────────────────────────────────────────────
  // STEP 2: Remove cached MOVE/Aptos prices from DB
  // ──────────────────────────────────────────────────────────────
  console.log('\n🧹 Step 2: Cleaning MOVE price caches (0x1, 0xa, aptos)...');

  const { error: delHistErr } = await supabase
    .from('token_price_history')
    .delete()
    .in('token_address', ['0x1', '0xa']);
  if (delHistErr) console.error('  ❌ token_price_history:', delHistErr.message);
  else console.log('  ✅ Cleared token_price_history for 0x1 and 0xa');

  const { error: delCacheErr } = await supabase
    .from('price_cache')
    .delete()
    .in('token_id', ['0x1', '0xa', 'aptos']);
  if (delCacheErr) console.error('  ❌ price_cache:', delCacheErr.message);
  else console.log('  ✅ Cleared price_cache for 0x1, 0xa, and aptos');

  // ──────────────────────────────────────────────────────────────
  // STEP 3: Fetch 1-year historical MOVE prices from CoinGecko
  // ──────────────────────────────────────────────────────────────
  console.log('\n📊 Step 3: Fetching 365-day historical prices for $MOVE from CoinGecko...');

  const apiKey = String(process.env.COINGECKO_API_KEY || '').trim();
  const isDemoKey = apiKey.startsWith('CG-');
  const baseHeaders: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    if (isDemoKey) baseHeaders['x-cg-demo-api-key'] = apiKey;
    else baseHeaders['x-cg-pro-api-key'] = apiKey;
  }

  const cgAttempts = [
    `https://demo-api.coingecko.com/api/v3/coins/movement/market_chart?vs_currency=usd&days=365`,
    `https://api.coingecko.com/api/v3/coins/movement/market_chart?vs_currency=usd&days=365`,
  ];

  let cgPrices: [number, number][] = [];

  for (const url of cgAttempts) {
    try {
      console.log(`  Trying: ${url}`);
      const requestHeaders = url.includes('demo-api.coingecko.com')
        ? baseHeaders
        : (isDemoKey ? { Accept: 'application/json' } : baseHeaders);
      const res = await (fetch as any)(url, { headers: requestHeaders });
      if (res.ok) {
        const data: any = await res.json();
        cgPrices = data.prices || [];
        if (cgPrices.length > 0) {
          console.log(`  ✅ Got ${cgPrices.length} data points from CoinGecko`);
          break;
        }
      } else {
        console.warn(`  ⚠️  ${res.status} from ${url}`);
      }
    } catch (e: any) {
      console.warn(`  ⚠️  Network error for ${url}: ${e.message}`);
    }
  }

  if (cgPrices.length > 0) {
    const historyEntries: any[] = [];
    cgPrices.forEach(([ts, price]) => {
      const dateStr = new Date(ts).toISOString();
      historyEntries.push({ token_address: '0x1', price, timestamp: dateStr, granularity: 'daily', source: 'coingecko' });
      historyEntries.push({ token_address: '0xa', price, timestamp: dateStr, granularity: 'daily', source: 'coingecko' });
    });

    const BATCH = 200;
    for (let i = 0; i < historyEntries.length; i += BATCH) {
      const { error } = await supabase.from('token_price_history').insert(historyEntries.slice(i, i + BATCH));
      if (error) console.error(`  ❌ Insert batch error:`, error.message);
    }
    console.log(`  ✅ Saved ${historyEntries.length} daily price entries for MOVE`);
  } else {
    console.warn('  ⚠️  CoinGecko unavailable — will rely on DexScreener fallback in backfiller');
  }

  // ──────────────────────────────────────────────────────────────
  // STEP 4: Reset all transactions for re-pricing
  // ──────────────────────────────────────────────────────────────
  console.log('\n🔄 Step 4: Resetting all transactions for re-pricing...');
  const { error: resetErr } = await supabase
    .from('user_transaction_history')
    .update({ is_processed: false, price_usd: null, value_usd: null })
    .eq('is_processed', true);
  if (resetErr) console.error('  ❌ Reset error:', resetErr.message);
  else console.log('  ✅ All transactions reset for re-pricing');

  // ──────────────────────────────────────────────────────────────
  // STEP 5: Run price backfiller
  // ──────────────────────────────────────────────────────────────
  console.log('\n⏳ Step 5: Re-pricing all transactions...');
  let batch = 0;
  while (true) {
    const { data: pending } = await supabase
      .from('user_transaction_history')
      .select('id')
      .eq('is_processed', false)
      .limit(1);
    if (!pending || pending.length === 0) break;
    batch++;
    console.log(`  Batch ${batch}...`);
    await backfillTransactionPrices(supabase, 200);
  }
  console.log(`  ✅ All transactions re-priced (${batch} batches)`);

  // ──────────────────────────────────────────────────────────────
  // STEP 6: Reconstruct portfolio for all wallets
  // ──────────────────────────────────────────────────────────────
  console.log('\n🔄 Step 6: Reconstructing portfolio history for all wallets...');
  const { data: users, error: usersErr } = await supabase
    .from('user_sync_status')
    .select('user_address');

  if (usersErr || !users) {
    console.error('  ❌ Failed to fetch wallets:', usersErr?.message);
    process.exit(1);
  }

  for (const { user_address } of users) {
    console.log(`  Reconstructing ${user_address}...`);
    try {
      await reconstructHistoricalBalances(supabase, user_address);
      console.log(`  ✅ Done`);
    } catch (e: any) {
      console.error(`  ❌ Failed: ${e.message}`);
    }
  }

  console.log('\n🎉 All done! Database is now clean and repaired.');
  process.exit(0);
}

run();
