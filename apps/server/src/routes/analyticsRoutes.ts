import { getSupabase } from '../config/supabase.ts';
/**
 * Analytics Routes
 * 
 * Extracted from index.ts inline route definitions.
 * All analytics-related endpoints live here.
 */

import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generalLimiter } from '../middleware/rateLimit.ts';
import { normalizeAddress } from '../utils/address.ts';
import { verifyWalletSignature } from '../utils/crypto.ts';
import { queueSync } from '../services/analyticsSyncQueue.ts';
import { reconstructHistoricalBalances } from '../services/portfolioService.ts';
import { aggregateAnalyticsData } from '../services/analyticsDataService.ts';
import { getEffectiveTier } from '../services/subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';
import {
  assertEnrichedWalletAccess,
  requireMaintenanceKey,
  walletAccessErrorHandler,
} from '../middleware/walletAccess.ts';

const router = Router();

// --- Helpers ---

function getSupabaseClient(req: Request): any {
  return getSupabase();
}

function parseWallet(req: Request): string {
  return normalizeAddress((req.query.wallet as string) || (req.query.address as string));
}

// --- Routes ---

/** Deep Sync — triggers background transaction sync */
router.get('/sync', generalLimiter, async (req: Request, res: Response) => {
  const wallet = parseWallet(req);
  if (!wallet) return res.status(400).json({ error: 'wallet is required' });

  const supabase = getSupabaseClient(req);
  if (!supabase) return res.status(503).json({ error: 'Service unavailable' });

  try {
    // Rate limit sync requests to once every 10 minutes per wallet
    const { data: statusData } = await supabase
      .from('user_sync_status')
      .select('last_sync_at')
      .eq('user_address', wallet)
      .maybeSingle();

    if (statusData?.last_sync_at) {
      const lastSyncTime = new Date(statusData.last_sync_at).getTime();
      const tenMinutes = 10 * 60 * 1000;
      if (Date.now() - lastSyncTime < tenMinutes) {
        return res.status(429).json({
          error: 'Sync requested too recently. Please wait up to 10 minutes between syncs.',
        });
      }
    }

    // Queue sync in the database-backed queue at high priority (10)
    await queueSync(supabase, wallet, 10);

    return res.status(202).json({
      ok: true,
      message: 'Sync job placed in queue',
      status: 'queued',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to start sync';
    console.error('[Analytics/Sync] Trigger Error:', err);
    return res.status(500).json({ error: message });
  }
});

/** Status Polling — check sync progress */
router.get('/status', async (req: Request, res: Response) => {
  const wallet = parseWallet(req);
  const supabase = getSupabaseClient(req);
  if (!wallet || !supabase) return res.status(400).json({ error: 'wallet required' });

  // Check if there is a pending job in the queue
  const { data: queueJob } = await supabase
    .from('sync_queue')
    .select('status')
    .eq('user_address', wallet)
    .eq('status', 'pending')
    .maybeSingle();

  if (queueJob) {
    return res.status(200).json({
      full_history_synced: false,
      total_transactions: 0,
      synced_transactions: 0,
      is_queued: true,
      status: 'queued'
    });
  }

  const { data, error } = await supabase
    .from('user_sync_status')
    .select('*')
    .eq('user_address', wallet)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to fetch status' });
  if (!data) return res.status(200).json({ full_history_synced: false, total_transactions: 0, synced_transactions: 0 });
  
  // Check if there is an active processing job in the queue
  const { data: processingJob } = await supabase
    .from('sync_queue')
    .select('status')
    .eq('user_address', wallet)
    .eq('status', 'processing')
    .maybeSingle();

  return res.status(200).json({
    ...data,
    status: processingJob ? 'syncing' : (data.full_history_synced ? 'completed' : 'idle')
  });
});

/** Portfolio Reconstruction */
router.get('/reconstruct', generalLimiter, async (req: Request, res: Response) => {
  const wallet = parseWallet(req);
  const supabase = getSupabaseClient(req);
  if (!wallet || !supabase) return res.status(400).json({ error: 'wallet required' });

  try {
    await assertEnrichedWalletAccess(supabase, req, wallet);
    const result = await reconstructHistoricalBalances(supabase, wallet);
    return res.status(200).json({
      ok: true,
      message: 'Portfolio history reconstructed successfully',
      ...result,
    });
  } catch (err: unknown) {
    if (walletAccessErrorHandler(err, res)) return;
    const message = err instanceof Error ? err.message : 'Failed to reconstruct portfolio';
    console.error('[Analytics/Reconstruct] Error:', err);
    return res.status(500).json({ error: message });
  }
});

/** Reprocess Unknown Transactions Maintenance Route */
router.get('/reprocess-unknowns', requireMaintenanceKey, async (req: Request, res: Response) => {
  const supabase = getSupabaseClient(req);
  if (!supabase) return res.status(503).json({ error: 'Database unavailable' });

  try {
    const { reProcessUnknownTransactions } = await import('../services/analyticsSyncService.ts');
    
    // Run reprocessing asynchronously so the HTTP request returns immediately
    reProcessUnknownTransactions(supabase)
      .then(() => console.log('[Maintenance] Finished reprocessing unknown transactions.'))
      .catch((err) => console.error('[Maintenance] Error during reprocessing unknown transactions:', err));

    return res.status(200).json({
      ok: true,
      message: 'Reprocess unknown transactions maintenance job triggered successfully',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to trigger reprocessing';
    console.error('[Analytics/ReprocessUnknowns] Error:', err);
    return res.status(500).json({ error: message });
  }
});

/** Hourly Networth History */
router.get('/networth', async (req: Request, res: Response) => {
  const wallet = parseWallet(req);
  const supabase = getSupabaseClient(req);
  if (!wallet || !supabase) return res.status(400).json({ error: 'wallet required' });

  try {
    await assertEnrichedWalletAccess(supabase, req, wallet);
    const { data: snapshots, error } = await supabase
      .from('user_networth_snapshots')
      .select('*')
      .eq('user_address', wallet)
      .order('timestamp', { ascending: true })
      .limit(168); // Last 7 days of hourly snapshots

    if (error) throw error;
    return res.json({ snapshots });
  } catch (err: unknown) {
    if (walletAccessErrorHandler(err, res)) return;
    console.error('[Analytics/Networth] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch networth history' });
  }
});

/** Set PNL Baseline */
router.post('/baseline', async (req: Request, res: Response) => {
  const { walletAddress, signature, signedMessage } = req.body;
  const wallet = normalizeAddress(walletAddress);

  if (!wallet) return res.status(400).json({ error: 'wallet required' });
  const supabase = getSupabaseClient(req);
  if (!supabase) return res.status(503).json({ error: 'Service unavailable' });
  if (!signature || !signedMessage) return res.status(401).json({ error: 'Signature required' });

  const isValid = verifyWalletSignature(wallet, signedMessage, signature);
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

  try {
    const { setPNLBaseline } = await import('../services/networthService.ts');
    const baseline = await setPNLBaseline(supabase, wallet);
    return res.json({ ok: true, baseline });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to set baseline';
    console.error('[Analytics/Baseline] Error:', err);
    return res.status(500).json({ error: message });
  }
});

async function resolveHistoryBaselineDate(
  supabase: SupabaseClient,
  wallet: string
): Promise<string | null> {
  const { data: earliestTx } = await supabase
    .from('user_transaction_history')
    .select('timestamp')
    .eq('user_address', wallet)
    .order('timestamp', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (earliestTx?.timestamp) {
    return String(earliestTx.timestamp).split('T')[0];
  }

  const { data: earliestSnap } = await supabase
    .from('user_networth_snapshots')
    .select('timestamp')
    .eq('user_address', wallet)
    .order('timestamp', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (earliestSnap?.timestamp) {
    return String(earliestSnap.timestamp).split('T')[0];
  }

  return null;
}

/** Precise PNL History */
router.get('/pnl-precise', async (req: Request, res: Response) => {
  const wallet = parseWallet(req);
  const timeframe = (req.query.timeframe as string) || '1M';
  const supabase = getSupabaseClient(req);

  if (!wallet || !supabase) return res.status(400).json({ error: 'wallet required' });

  try {
    await assertEnrichedWalletAccess(supabase, req, wallet);
    const startDate = new Date();
    if (timeframe === '1D') startDate.setHours(startDate.getHours() - 24);
    else if (timeframe === '1W') startDate.setDate(startDate.getDate() - 7);
    else if (timeframe === '1M') startDate.setMonth(startDate.getMonth() - 1);
    else if (timeframe === '3M') startDate.setMonth(startDate.getMonth() - 3);
    else if (timeframe === '1Y') startDate.setFullYear(startDate.getFullYear() - 1);
    else startDate.setFullYear(startDate.getFullYear() - 5);

    const { data: snapshots, error: snapError } = await supabase
      .from('user_networth_snapshots')
      .select('total_networth_usd, net_deposits_usd, timestamp')
      .eq('user_address', wallet)
      .gte('timestamp', startDate.toISOString())
      .order('timestamp', { ascending: true });

    if (snapError) throw snapError;

    if (!snapshots || snapshots.length === 0) {
      return res.json({ history: [], performance: { changeUsd: 0, changePercent: 0 } });
    }

    const history = snapshots.map((s: { timestamp: string; total_networth_usd: number | string; net_deposits_usd: number | string | null }) => ({
      date: s.timestamp,
      value: Number(s.total_networth_usd),
      netDeposits: Number(s.net_deposits_usd || 0),
    }));

    if (timeframe === 'All') {
      const baselineDate = await resolveHistoryBaselineDate(supabase, wallet);
      if (baselineDate && history[0].date > `${baselineDate}T00:00:00.000Z`) {
        history.unshift({
          date: `${baselineDate}T00:00:00.000Z`,
          value: 0,
          netDeposits: 0,
        });
      }
    }

    const firstPoint = history[0];
    const lastPoint = history[history.length - 1];
    const changeUsd = (lastPoint.value - firstPoint.value) - (lastPoint.netDeposits - firstPoint.netDeposits);
    const baseValue = firstPoint.value > 0 ? firstPoint.value : Math.max(lastPoint.netDeposits - firstPoint.netDeposits, 0.01);
    const changePercent = baseValue > 0.01 ? (changeUsd / baseValue) * 100 : 0;

    return res.json({
      history,
      performance: {
        changeUsd: Math.round(changeUsd * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
      },
    });
  } catch (err: unknown) {
    if (walletAccessErrorHandler(err, res)) return;
    console.error('[Analytics/PNL-Precise] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch PNL history' });
  }
});

/** Full Analytics Data Aggregation */
router.get('/data', async (req: Request, res: Response) => {
  const wallet = parseWallet(req);
  const timeframe = (req.query.timeframe as string) || 'All';
  const customStartDate = req.query.startDate as string | undefined;
  const customEndDate = req.query.endDate as string | undefined;
  const supabase = getSupabaseClient(req);

  if (!wallet || !supabase) return res.status(400).json({ error: 'wallet required' });

  try {
    await assertEnrichedWalletAccess(supabase, req, wallet);
    const result = await aggregateAnalyticsData(supabase, wallet, timeframe, customStartDate, customEndDate);
    return res.status(200).json(result);
  } catch (err: unknown) {
    if (walletAccessErrorHandler(err, res)) return;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;
