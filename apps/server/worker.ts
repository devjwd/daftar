import dotenv from 'dotenv';
import { getSupabase } from './src/config/supabase.ts';
import { startPricePitcher } from './src/services/priceService.ts';
import { startAnalyticsWorker } from './src/services/analyticsWorker.ts';
import { startNFTPriceWorker } from './src/services/nftPriceWorker.ts';
import { backfillTransactionPrices } from './src/services/analyticsPriceService.ts';
import { processSyncQueue } from './src/services/analyticsSyncQueue.ts';

dotenv.config();

const supabaseAdmin = getSupabase();

console.log('[Worker] Starting background workers...');

// Start background price pitcher
startPricePitcher(supabaseAdmin);

// Start 24/7 Background Analytics Worker for Verified Users
startAnalyticsWorker(supabaseAdmin);

// Start hourly NFT floor price pitcher
startNFTPriceWorker(supabaseAdmin);

// Start background analytics price backfiller (every 30 seconds)
let isPriceBackfillRunning = false;
setInterval(async () => {
  if (!isPriceBackfillRunning) {
    isPriceBackfillRunning = true;
    try {
      await backfillTransactionPrices(supabaseAdmin, 50);
    } catch (err) {
      console.error('[Worker] Analytics Backfill Loop Error:', err);
    } finally {
      isPriceBackfillRunning = false;
    }
  }
}, 30000);

// Start background sync queue worker (every 5 seconds)
let isSyncQueueRunning = false;
setInterval(async () => {
  if (!isSyncQueueRunning) {
    isSyncQueueRunning = true;
    try {
      await processSyncQueue(supabaseAdmin);
    } catch (err) {
      console.error('[Worker] Sync Queue Worker Error:', err);
    } finally {
      isSyncQueueRunning = false;
    }
  }
}, 5000);

console.log('[Worker] Background workers started successfully.');
