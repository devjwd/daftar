import { SupabaseClient } from '@supabase/supabase-js';
import { syncFullUserHistory, reProcessUnknownTransactions } from './analyticsSyncService.ts';
import { reProcessSuspiciousPrices } from './analyticsPriceService.ts';

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

      // 1. Fetch all verified users
      // Note: If you have millions of users, you would need cursor-based pagination here.
      // For now, fetching them all or using a limit/offset is fine.
      const { data: verifiedUsers, error } = await supabase
        .from('profiles')
        .select('wallet_address')
        .eq('is_verified', true);

      if (error) {
        console.error('[AnalyticsWorker] Failed to fetch verified users:', error);
        throw error;
      }

      if (verifiedUsers && verifiedUsers.length > 0) {
        console.log(`[AnalyticsWorker] 🔄 Found ${verifiedUsers.length} verified users. Beginning sync cycle.`);

        // 2. Iterate through each verified user sequentially
        for (const user of verifiedUsers) {
          if (!user.wallet_address) continue;
          
          try {
             // syncFullUserHistory already handles forward sync (new txs) and backward sync.
             // It also already has a 200ms delay between batch requests internally.
             await syncFullUserHistory(supabase, user.wallet_address);
          } catch (syncErr: any) {
             console.error(`[AnalyticsWorker] Error syncing user ${user.wallet_address}:`, syncErr.message);
          }

          // Sleep 1 second between different users to ensure healthy connection & no rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

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
