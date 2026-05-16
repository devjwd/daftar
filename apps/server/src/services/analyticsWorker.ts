import { SupabaseClient } from '@supabase/supabase-js';
import { syncFullUserHistory, reProcessUnknownTransactions } from './analyticsSyncService.ts';
import { reProcessSuspiciousPrices } from './analyticsPriceService.ts';
import { takeNetworthSnapshot } from './networthService.ts';

/**
 * Background worker that continuously syncs verified users.
 * 
 * - Loops through all verified profiles.
 * - Triggers an incremental sync (both forward and backward) via syncFullUserHistory.
 * - Sleeps between users and batches to respect Indexer rate limits.
 * - Uses exponential backoff on consecutive errors.
 */
export async function startAnalyticsWorker(supabase: SupabaseClient) {
  console.log('[AnalyticsWorker] 🤖 Starting 24/7 background worker for verified users...');

  const BASE_SLEEP_MS = 5 * 60 * 1000; // 5 minutes
  const MAX_SLEEP_MS = 30 * 60 * 1000; // 30 minutes max backoff
  let consecutiveErrors = 0;

  // The main loop
  const runLoop = async () => {
    try {
      // 0. Retroactively fix any Unknown protocols or suspicious prices
      await reProcessUnknownTransactions(supabase);
      await reProcessSuspiciousPrices(supabase);

      // 1. Fetch all verified users using cursor-based pagination
      let hasMoreUsers = true;
      let page = 0;
      const USERS_PER_PAGE = 100;
      let totalProcessed = 0;

      while (hasMoreUsers) {
        const { data: verifiedUsers, error } = await supabase
          .from('profiles')
          .select('wallet_address')
          .eq('is_verified', true)
          .range(page * USERS_PER_PAGE, (page + 1) * USERS_PER_PAGE - 1);

        if (error) {
          console.error('[AnalyticsWorker] Failed to fetch verified users:', error);
          throw error;
        }

        if (verifiedUsers && verifiedUsers.length > 0) {
          if (page === 0) console.log(`[AnalyticsWorker] 🔄 Beginning sync cycle. Fetching in batches...`);
          
          // 2. Iterate through each verified user sequentially
          for (const user of verifiedUsers) {
            if (!user.wallet_address) continue;
            
            try {
               await syncFullUserHistory(supabase, user.wallet_address);
               await takeNetworthSnapshot(supabase, user.wallet_address);

            } catch (syncErr: any) {
               console.error(`[AnalyticsWorker] Error syncing user ${user.wallet_address}:`, syncErr.message);
            }

            // Sleep 1 second between different users to ensure healthy connection & no rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
            totalProcessed++;
          }
          
          page++;
          if (verifiedUsers.length < USERS_PER_PAGE) hasMoreUsers = false;
        } else {
          hasMoreUsers = false;
        }
      }
      
      console.log(`[AnalyticsWorker] ✅ Sync cycle complete. Total users processed: ${totalProcessed}`);

      // Reset backoff on successful cycle
      consecutiveErrors = 0;

    } catch (e: any) {
      consecutiveErrors++;
      console.error(`[AnalyticsWorker] Main loop error (consecutive: ${consecutiveErrors}):`, e.message);
    } finally {
      // Exponential backoff: 5min, 10min, 15min, ..., max 30min
      const sleepMs = Math.min(MAX_SLEEP_MS, BASE_SLEEP_MS * (1 + consecutiveErrors));
      console.log(`[AnalyticsWorker] 💤 Cycle complete. Sleeping for ${Math.round(sleepMs / 60000)} minutes...`);
      setTimeout(runLoop, sleepMs);
    }
  };

  // Start the first cycle
  runLoop();
}
