import dotenv from 'dotenv';
import { getSupabase } from './src/config/supabase.ts';
import { startPricePitcher } from './src/services/priceService.ts';
import { startAnalyticsWorker } from './src/services/analyticsWorker.ts';

import { backfillTransactionPrices } from './src/services/analyticsPriceService.ts';
import { drainSyncQueue } from './src/services/analyticsSyncQueue.ts';
// Telegram bot is initialized in index.ts for webhooks
import { initDiscordBot } from './src/bots/discord/discordBot.ts';
import { startSubscriptionSyncWorker } from './src/services/subscriptionSyncWorker.ts';

dotenv.config();

const supabaseAdmin = getSupabase();

console.log('[Worker] Starting background workers...');

initDiscordBot();

// Start background price pitcher
startPricePitcher(supabaseAdmin);

// Start 24/7 Background Analytics Worker for Verified Users
startAnalyticsWorker(supabaseAdmin);

// Start Discord Role Subscription Synchronization Worker
startSubscriptionSyncWorker(supabaseAdmin);



let isShuttingDown = false;

// Start background analytics price backfiller (fallback interval: every 10 seconds)
let isPriceBackfillRunning = false;
setInterval(async () => {
  if (!isPriceBackfillRunning && !isShuttingDown) {
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
  if (!isSyncQueueRunning && !isShuttingDown) {
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

// Handle graceful shutdown for Railway deployments
const gracefulShutdown = () => {
  console.log('[Worker] 🛑 Received kill signal, initiating graceful shutdown...');
  isShuttingDown = true;
  
  // Give processing jobs up to 15 seconds to finish before exiting
  setTimeout(() => {
    console.log('[Worker] 💀 Forcefully shutting down after timeout.');
    process.exit(0);
  }, 15000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

