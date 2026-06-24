import cron from 'node-cron';
import { getSupabase } from '../config/supabase.ts';
import { runExchangeCrawler } from '../services/exchangeCrawlerService.ts';
import { cleanupAddressLabels } from './cleanupAddressLabels.ts';

/**
 * Initializes all background cron jobs for the server.
 */
export function initCronJobs() {
  console.log('[Cron] Initializing scheduled jobs...');

  // 1. Exchange Crawler Job: Runs every 6 hours (0 */6 * * *)
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Cron] Triggering scheduled Exchange Crawler...');
    const supabaseAdmin = getSupabase();
    if (supabaseAdmin) {
      try {
        await runExchangeCrawler(supabaseAdmin);
      } catch (err) {
        console.error('[Cron] Exchange Crawler failed:', err);
      }
    } else {
      console.error('[Cron] Supabase Admin client not available for Crawler.');
    }
  });

  // 2. Database Bloat Cleanup Job: Runs once a day at midnight (0 0 * * *)
  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron] Triggering scheduled Database Cleanup...');
    try {
      await cleanupAddressLabels();
    } catch (err) {
      console.error('[Cron] Database Cleanup failed:', err);
    }
  });

  console.log('[Cron] Scheduled jobs initialized successfully.');
}
