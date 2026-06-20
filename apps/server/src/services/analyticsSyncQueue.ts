import { SupabaseClient } from '@supabase/supabase-js';
import { syncFullUserHistory } from './analyticsSyncService.ts';
import { takeNetworthSnapshot } from './networthService.ts';
import { backfillTransactionPrices } from './analyticsPriceService.ts';
import { analyticsCache } from './analyticsCache.ts';

/**
 * Queue a wallet address for transaction sync.
 * If there is already a pending or processing job for this address, it keeps the existing job.
 * If priority is higher than the existing job's priority, it updates the priority of a pending job.
 */
export async function queueSync(
  supabase: SupabaseClient,
  walletAddress: string,
  priority: number = 0
) {
  const address = walletAddress.toLowerCase().trim();

  // Check if there is an active job (pending or processing)
  const { data: existingJob, error: checkError } = await supabase
    .from('sync_queue')
    .select('id, status, priority')
    .eq('user_address', address)
    .in('status', ['pending', 'processing'])
    .maybeSingle();

  if (checkError) {
    console.error(`[SyncQueue] Error checking active job for ${address}:`, checkError.message);
  }

  if (existingJob) {
    // If the new request has higher priority, raise the priority of the pending job
    if (existingJob.status === 'pending' && priority > (existingJob.priority || 0)) {
      await supabase
        .from('sync_queue')
        .update({ priority, updated_at: new Date().toISOString() })
        .eq('id', existingJob.id);
    }
    return existingJob;
  }

  // Insert or reset job to pending
  const { data: newJob, error: insertError } = await supabase
    .from('sync_queue')
    .upsert({
      user_address: address,
      status: 'pending',
      priority,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_address' })
    .select()
    .single();

  if (insertError) {
    console.error(`[SyncQueue] Error queueing sync for ${address}:`, insertError.message);
    throw insertError;
  }

  return newJob;
}

/**
 * (claimNextPendingJob was removed in favor of Supabase RPC `claim_sync_jobs` using SKIP LOCKED)
 */

/**
 * Internal: execute a single locked sync job to completion.
 */
async function executeLockedJob(
  supabase: SupabaseClient,
  lockedJob: { id: string; user_address: string; priority: number | null }
): Promise<void> {
  const { id, user_address: address } = lockedJob;

  console.log(`[SyncQueue] 🚀 Processing sync job for ${address} (Priority: ${lockedJob.priority})...`);

  try {
    // Deep sync: fetch all transactions from blockchain and store in DB
    const syncResult = await syncFullUserHistory(supabase, address);
    const hasNewTx = syncResult && syncResult.totalSynced > 0;

    // Take net worth snapshot (force if new transactions synced or high-priority)
    const forceSnapshot = hasNewTx || (lockedJob.priority || 0) > 0;
    await takeNetworthSnapshot(supabase, address, forceSnapshot);

    // Mark job as completed
    await supabase
      .from('sync_queue')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id);

    console.log(`[SyncQueue] ✅ Successfully processed sync job for ${address}`);

    // Invalidate analytics cache so next request re-computes fresh data
    analyticsCache.invalidate(address);

    // Price backfill runs in background — don't block the queue
    void backfillTransactionPrices(supabase, 200, address).catch(err => {
      console.error('[SyncQueue] Immediate price backfill error:', err.message);
    });

  } catch (err: any) {
    console.error(`[SyncQueue] ❌ Failed processing sync job for ${address}:`, err.message);

    // Fetch current retry count to determine if it should go to DLQ
    const { data: jobData } = await supabase
      .from('sync_queue')
      .select('retry_count')
      .eq('id', id)
      .single();

    const currentRetryCount = jobData?.retry_count || 0;
    const nextRetryCount = currentRetryCount + 1;
    const nextStatus = nextRetryCount >= 3 ? 'dlq' : 'failed';

    if (nextStatus === 'dlq') {
      console.error(`[SyncQueue] 🚨 Job for ${address} moved to Dead Letter Queue after ${nextRetryCount} failures.`);
    }

    await supabase
      .from('sync_queue')
      .update({
        status: nextStatus,
        retry_count: nextRetryCount,
        error_message: err.message || 'Unknown error',
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
  }
}

/**
 * Process the next single pending job in the queue (single-job, backward-compat).
 * Orders by priority (descending) then created_at (ascending).
 */
export async function processSyncQueue(supabase: SupabaseClient): Promise<void> {
  const { data: jobs, error } = await supabase.rpc('claim_sync_jobs', { limit_count: 1 });
  if (error) {
    console.error('[SyncQueue] Error claiming job:', error.message);
    return;
  }
  if (!jobs || jobs.length === 0) return;
  await executeLockedJob(supabase, jobs[0]);
}

/**
 * Drain the sync queue by processing up to `concurrency` jobs in parallel.
 *
 * This is the production-grade entrypoint that handles bursts of concurrent upgrades.
 * With concurrency=5 and jobs taking ~30s each, throughput is ~10 jobs/min vs 12/min
 * serially — but latency for each individual user drops from minutes to seconds.
 *
 * Each job is claimed natively in the database using SKIP LOCKED, preventing double-processing 
 * even when multiple server instances or concurrent intervals call this function simultaneously.
 *
 * @returns Number of jobs that were started this drain cycle.
 */
export async function drainSyncQueue(
  supabase: SupabaseClient,
  concurrency: number = 5
): Promise<number> {
  // Claim jobs directly from the database using Postgres SKIP LOCKED
  const { data: jobs, error } = await supabase.rpc('claim_sync_jobs', { limit_count: concurrency });
  
  if (error) {
    console.error('[SyncQueue] Error draining queue via RPC:', error.message);
    return 0;
  }

  if (!jobs || jobs.length === 0) return 0;

  console.log(`[SyncQueue] 🔄 Draining queue: ${jobs.length} jobs running in parallel...`);

  // Execute all claimed jobs concurrently
  const jobPromises = jobs.map((job: any) => executeLockedJob(supabase, job));

  // Wait for all jobs, capturing errors (each job handles its own error internally)
  await Promise.allSettled(jobPromises);

  console.log(`[SyncQueue] ✅ Drain cycle complete. Ran ${jobs.length} jobs.`);
  return jobs.length;
}
