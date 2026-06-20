import { SupabaseClient } from '@supabase/supabase-js';
import { reProcessUnknownTransactions } from './analyticsSyncService.ts';
import { reProcessSuspiciousPrices } from './analyticsPriceService.ts';
import { drainSyncQueue } from './analyticsSyncQueue.ts';
import { cleanupExpiredSubscriptions } from './subscriptionService.ts';

const CONCURRENCY_LIMIT = 5;

/**
 * Background worker that continuously syncs verified and pro users.
 */
export async function startAnalyticsWorker(supabase: SupabaseClient) {
  console.log('[AnalyticsWorker] 🤖 Starting 24/7 optimized background worker for verified/pro users...');

  const BASE_SLEEP_MS = 60 * 1000;  // 1 minute (tighter loop, since queueing is now near-instant)
  const MAX_SLEEP_MS = 5 * 60 * 1000;  // 5 minutes max on repeated errors
  let consecutiveErrors = 0;
  let lastCleanupTime = 0;
  const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

  const runLoop = async () => {
    try {
      const now = Date.now();
      if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
        console.log('[AnalyticsWorker] Running database maintenance and cleanups...');
        await reProcessUnknownTransactions(supabase);
        await reProcessSuspiciousPrices(supabase);
        lastCleanupTime = now;
      }

      // Check for expired subscriptions and clear their data first
      await cleanupExpiredSubscriptions(supabase);

      // Instantly queue users via DB-side Postgres Function (Memory: ~0MB, Time: ~50ms)
      console.log(`[AnalyticsWorker] 🔄 Pushing due Pro users into DB queue...`);
      const { error: enqueueErr } = await supabase.rpc('enqueue_due_users', { 
        pro_interval: '5 minutes'
      });

      if (enqueueErr) {
        throw new Error(`Queue RPC failed: ${enqueueErr.message}`);
      }

      // Drain up to 5 sync jobs in parallel for faster throughput
      // This will pull any pending jobs (whether pushed just now or waiting from earlier)
      void drainSyncQueue(supabase, CONCURRENCY_LIMIT).catch(err => {
        console.error('[AnalyticsWorker] Queue drain error:', err.message);
      });

      consecutiveErrors = 0;
    } catch (e: unknown) {
      consecutiveErrors++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[AnalyticsWorker] Main loop error (consecutive: ${consecutiveErrors}):`, message);
    } finally {
      const sleepMs = Math.min(MAX_SLEEP_MS, BASE_SLEEP_MS * (1 + consecutiveErrors));
      console.log(`[AnalyticsWorker] 💤 Cycle complete. Sleeping for ${Math.round(sleepMs / 1000)} seconds...`);
      setTimeout(runLoop, sleepMs);
    }
  };

  runLoop();
}

/**
 * One-shot execution of the analytics worker, intended to be triggered by a CRON job or external scheduler.
 * This avoids the memory leaks and crashes associated with infinite `setTimeout` loops.
 */
export async function runOneShotAnalytics(supabase: SupabaseClient) {
  console.log('[AnalyticsWorker] 🤖 Running one-shot analytics sync cycle...');
  try {
    // 1. Cleanups
    await cleanupExpiredSubscriptions(supabase);
    // Note: We leave reProcessUnknownTransactions to a separate daily CRON for cleaner separation.

    // 2. Queue due users
    console.log(`[AnalyticsWorker] 🔄 Pushing due Pro users into DB queue...`);
    const { error: enqueueErr } = await supabase.rpc('enqueue_due_users', { 
      pro_interval: '5 minutes'
    });

    if (enqueueErr) {
      throw new Error(`Queue RPC failed: ${enqueueErr.message}`);
    }

    // 3. Drain queue
    await drainSyncQueue(supabase, CONCURRENCY_LIMIT);
    console.log('[AnalyticsWorker] ✅ One-shot cycle complete.');
  } catch (err: any) {
    console.error(`[AnalyticsWorker] One-shot cycle error:`, err.message);
    throw err;
  }
}
