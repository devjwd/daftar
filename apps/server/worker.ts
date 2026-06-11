import dotenv from 'dotenv';
import { getSupabase } from './src/config/supabase.ts';
import { startPricePitcher } from './src/services/priceService.ts';
import { startAnalyticsWorker } from './src/services/analyticsWorker.ts';
import { startNFTPriceWorker } from './src/services/nftPriceWorker.ts';
import { backfillTransactionPrices } from './src/services/analyticsPriceService.ts';
import { processSyncQueue } from './src/services/analyticsSyncQueue.ts';
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

// Start background analytics price backfiller (fallback interval: every 5 minutes)
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
}, 300000); // 5 minutes

// Start background sync queue worker (fallback interval: every 60 seconds)
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
}, 60000); // 60 seconds

console.log('[Worker] Background workers started successfully.');
