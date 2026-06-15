import dotenv from 'dotenv';
import { getSupabase } from './src/config/supabase.ts';
import { startPricePitcher } from './src/services/priceService.ts';
import { startAnalyticsWorker } from './src/services/analyticsWorker.ts';
import { startNFTPriceWorker } from './src/services/nftPriceWorker.ts';
import { backfillTransactionPrices } from './src/services/analyticsPriceService.ts';
import { drainSyncQueue } from './src/services/analyticsSyncQueue.ts';
import { initTelegramBot } from './src/bots/telegram/telegramBot.ts';
import { initDiscordBot } from './src/bots/discord/discordBot.ts';

dotenv.config();

const supabaseAdmin = getSupabase();

console.log('[Worker] Starting background workers...');

// Start Telegram and Discord bots
initTelegramBot();
initDiscordBot();

// Start background price pitcher
startPricePitcher(supabaseAdmin);

// Start 24/7 Background Analytics Worker for Verified Users
startAnalyticsWorker(supabaseAdmin);

// Start hourly NFT floor price pitcher
// startNFTPriceWorker(supabaseAdmin); // Temporarily disabled by user request

// Start background analytics price backfiller (fallback interval: every 10 seconds)
let isPriceBackfillRunning = false;
setInterval(async () => {
  if (!isPriceBackfillRunning) {
    isPriceBackfillRunning = true;
    try {
      await backfillTransactionPrices(supabaseAdmin, 500);
    } catch (err) {
      console.error('[Worker] Analytics Backfill Loop Error:', err);
    } finally {
      isPriceBackfillRunning = false;
    }
  }
}, 10000); // 10 seconds

// Start background sync queue worker — drains up to 5 jobs in parallel every 3 seconds.
// At 5 concurrent jobs x ~20-30s per sync, throughput is ~60-90 jobs/min.
// 50 simultaneous Pro upgrades are cleared within ~30-60 seconds.
let isSyncQueueRunning = false;
setInterval(async () => {
  if (!isSyncQueueRunning) {
    isSyncQueueRunning = true;
    try {
      await drainSyncQueue(supabaseAdmin, 5);
    } catch (err) {
      console.error('[Worker] Sync Queue Worker Error:', err);
    } finally {
      isSyncQueueRunning = false;
    }
  }
}, 3000); // 3 seconds — tighter loop for faster responsiveness

console.log('[Worker] Background workers started successfully.');
