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
import { queueSync, processSyncQueue } from '../services/analyticsSyncQueue.ts';
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

    // Immediately trigger processing in the background asynchronously
    void processSyncQueue(supabase).catch(err => {
      console.error('[Analytics/Sync] Immediate queue processing error:', err.message);
    });

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

/** On-Demand Trigger Sync (For Free Users) */
router.post('/trigger-sync', generalLimiter, async (req: Request, res: Response) => {
  const wallet = normalizeAddress(req.body.walletAddress || req.body.wallet);
  if (!wallet) return res.status(400).json({ error: 'wallet is required' });

  const supabase = getSupabaseClient(req);
  if (!supabase) return res.status(503).json({ error: 'Service unavailable' });

  try {
    // Check if the user has a profile created
    const { data: profile } = await supabase
      .from('profiles')
      .select('wallet_address')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (!profile) {
      return res.status(403).json({ 
        error: 'Profile required', 
        message: 'You must create a profile to sync your portfolio.' 
      });
    }

    const { data: queueData } = await supabase
      .from('sync_queue')
      .select('status, updated_at')
      .eq('user_address', wallet)
      .maybeSingle();

    if (queueData) {
      if (queueData.status === 'processing') {
        return res.status(200).json({ status: 'processing', message: 'Sync already in progress' });
      }

      if (queueData.updated_at) {
        const lastUpdate = new Date(queueData.updated_at).getTime();
        const oneHour = 60 * 60 * 1000;
        if (Date.now() - lastUpdate < oneHour) {
          return res.status(200).json({ 
            status: 'cooldown', 
            message: 'Sync requested too recently. Please wait 1 hour between on-demand syncs.' 
          });
        }
      }
    }

    // Queue sync in the database-backed queue at priority 0
    await queueSync(supabase, wallet, 0);

    return res.status(202).json({
      ok: true,
      message: 'On-demand sync queued successfully',
      status: 'queued',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to trigger sync';
    console.error('[Analytics/TriggerSync] Error:', err);
    return res.status(500).json({ error: message });
  }
});

/** Status Polling — check sync progress */
router.get('/status', async (req: Request, res: Response) => {
  const wallet = parseWallet(req);
  const supabase = getSupabaseClient(req);
  if (!wallet || !supabase) return res.status(400).json({ error: 'wallet required' });

  const { data: statusData, error } = await supabase
    .from('user_sync_status')
    .select('*')
    .eq('user_address', wallet)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to fetch status' });
  
  const data = statusData || { full_history_synced: false, total_transactions: 0, synced_transactions: 0 };
  
  // Check if there is an active job in the queue (pending or processing)
  const { data: activeJob } = await supabase
    .from('sync_queue')
    .select('status')
    .eq('user_address', wallet)
    .in('status', ['pending', 'processing'])
    .maybeSingle();

  let statusStr = data.full_history_synced ? 'completed' : 'idle';
  if (activeJob) {
    statusStr = activeJob.status === 'processing' ? 'syncing' : 'queued';
  }

  return res.status(200).json({
    ...data,
    is_queued: activeJob?.status === 'pending',
    status: statusStr
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
router.all('/pnl-precise', async (req: Request, res: Response) => {
  const wallet = parseWallet(req);
  const timeframe = (req.query.timeframe as string) || '1M';
  const supabase = getSupabaseClient(req);

  if (!wallet || !supabase) return res.status(400).json({ error: 'wallet required' });

  try {
    try {
      await assertEnrichedWalletAccess(supabase, req, wallet);
    } catch (err: any) {
      if (err.name === 'WalletAccessError') {
        if (timeframe !== '1D') {
          throw err;
        }
        // For 1D, we now allow access even without a profile
      } else {
        throw err;
      }
    }

    const startDate = new Date();
    if (timeframe === '1D') startDate.setHours(startDate.getHours() - 24);
    else if (timeframe === '1W') startDate.setDate(startDate.getDate() - 7);
    else if (timeframe === '1M') startDate.setMonth(startDate.getMonth() - 1);
    else if (timeframe === '3M') startDate.setMonth(startDate.getMonth() - 3);
    else if (timeframe === '1Y') startDate.setFullYear(startDate.getFullYear() - 1);
    else startDate.setFullYear(startDate.getFullYear() - 5);

    // For 1D timeframe, dynamically project using 5-minute price history if available
    if (timeframe === '1D') {
      try {
        let balances: any[] = req.body?.balances || [];
        let staticExtraUsd = Number(req.body?.staticExtraUsd || 0);
        console.log(`[PNL-Precise] 1D projection for ${wallet}. Balances from req.body:`, balances?.length);

        if (!balances || balances.length === 0) {
          const { data: latestDateRow } = await supabase
            .from('user_balance_snapshots')
            .select('snapshot_date')
            .eq('user_address', wallet)
            .order('snapshot_date', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latestDateRow) {
            const { data: bData } = await supabase
              .from('user_balance_snapshots')
              .select('asset_type, symbol, amount')
              .eq('user_address', wallet)
              .eq('snapshot_date', latestDateRow.snapshot_date);
            balances = bData || [];
            console.log(`[PNL-Precise] Fetched ${balances.length} balances from DB snapshot.`);
          }
          
          if (!req.body?.staticExtraUsd) {
            const { data: latestNetworthRow } = await supabase
              .from('user_networth_snapshots')
              .select('defi_usd, nft_usd')
              .eq('user_address', wallet)
              .order('timestamp', { ascending: false })
              .limit(1)
              .maybeSingle();
              
            if (latestNetworthRow) {
              // Balance snapshots only have wallet tokens; add defi_usd + nft_usd as static extra
              staticExtraUsd = Number(latestNetworthRow.defi_usd || 0) + Number(latestNetworthRow.nft_usd || 0);
            }
          }
        }

        const { data: priceHist } = await supabase
          .from('token_price_history')
          .select('token_address, price, timestamp')
          .eq('granularity', '5min')
          .gte('timestamp', startDate.toISOString())
          .order('timestamp', { ascending: true });

        if (priceHist && priceHist.length >= 2 && balances.length > 0) {
          const { data: cachedPrices } = await supabase.from('price_cache').select('token_id, price_usd');
          const fallbackPrices: Record<string, number> = {};
          if (cachedPrices) {
            cachedPrices.forEach((p: any) => {
              const token = p.token_id.toLowerCase().replace(/^0x0*/, '0x');
              fallbackPrices[token] = Number(p.price_usd);
            });
          }

          const { LST_PRICE_ALIASES, NATIVE_MOVE_ADDRESSES, INFLOW_ACTIONS, OUTFLOW_ACTIONS, KNOWN_EXCHANGES } = await import('../config/whitelists.ts');

          const pricesByTime: Record<string, Record<string, number>> = {};
          priceHist.forEach((hp: any) => {
            const timeKey = new Date(hp.timestamp).toISOString();
            const token = hp.token_address.toLowerCase().replace(/^0x0*/, '0x');
            if (!pricesByTime[timeKey]) pricesByTime[timeKey] = {};
            pricesByTime[timeKey][token] = Number(hp.price);
          });

          const { data: periodTxs } = await supabase
            .from('user_transaction_history')
            .select('timestamp, value_usd, action, protocol, asset_in_symbol, asset_in_amount, asset_out_symbol, asset_out_amount')
            .eq('user_address', wallet)
            .gte('timestamp', startDate.toISOString())
            .order('timestamp', { ascending: true });

          const { data: startingSnap } = await supabase
            .from('user_networth_snapshots')
            .select('net_deposits_usd')
            .eq('user_address', wallet)
            .gte('timestamp', startDate.toISOString())
            .order('timestamp', { ascending: true })
            .limit(1)
            .maybeSingle();

          const baseNetDeposits = Number(startingSnap?.net_deposits_usd || 0);

          const sortedTxs = (periodTxs || []).map((t: any) => ({
            time: new Date(t.timestamp).getTime(),
            val: Number(t.value_usd || 0),
            action: t.action,
            protocol: t.protocol || '',
            asset_in_symbol: t.asset_in_symbol,
            asset_in_amount: Number(t.asset_in_amount || 0),
            asset_out_symbol: t.asset_out_symbol,
            asset_out_amount: Number(t.asset_out_amount || 0),
          }));

          const uniqueTimestamps = Object.keys(pricesByTime).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

          let runningNetDeposits = baseNetDeposits;
          let txIndexAsc = 0;
          const netDepositsMap: Record<string, number> = {};

          // First pass: compute netDeposits ascending
          for (const timeISO of uniqueTimestamps) {
            const timestampMs = new Date(timeISO).getTime();
            while (txIndexAsc < sortedTxs.length && sortedTxs[txIndexAsc].time <= timestampMs) {
              const tx = sortedTxs[txIndexAsc];
              const isExchange = KNOWN_EXCHANGES.has(tx.protocol) || tx.protocol.includes('Exchange') || tx.protocol.includes('Bridge');
              if (isExchange) {
                if (INFLOW_ACTIONS.includes(tx.action)) runningNetDeposits += tx.val;
                else if (OUTFLOW_ACTIONS.includes(tx.action)) runningNetDeposits -= tx.val;
              }
              txIndexAsc++;
            }
            netDepositsMap[timeISO] = runningNetDeposits;
          }

          // Second pass: replay balances descending
          const sortedTxsDesc = [...sortedTxs].sort((a, b) => b.time - a.time);
          let txIndexDesc = 0;
          const virtualBalances = JSON.parse(JSON.stringify(balances || []));
          const reversedTimestamps = [...uniqueTimestamps].reverse();

          const historyReversed = reversedTimestamps.map((timeISO) => {
            const timestampMs = new Date(timeISO).getTime();

            // Revert txs that happened AFTER this timestamp
            while (txIndexDesc < sortedTxsDesc.length && sortedTxsDesc[txIndexDesc].time > timestampMs) {
              const tx = sortedTxsDesc[txIndexDesc];
              
              if (tx.asset_in_symbol && tx.asset_in_amount) {
                const existingIn = virtualBalances.find((b: any) => b.symbol?.toUpperCase() === tx.asset_in_symbol.toUpperCase());
                if (existingIn) {
                  existingIn.amount = Math.max(0, Number(existingIn.amount) - tx.asset_in_amount);
                }
              }
              
              if (tx.asset_out_symbol && tx.asset_out_amount) {
                const existingOut = virtualBalances.find((b: any) => b.symbol?.toUpperCase() === tx.asset_out_symbol.toUpperCase());
                if (existingOut) {
                  existingOut.amount = Number(existingOut.amount) + tx.asset_out_amount;
                } else {
                  virtualBalances.push({ symbol: tx.asset_out_symbol, amount: tx.asset_out_amount, asset_type: '' });
                }
              }
              txIndexDesc++;
            }

            let totalValuation = staticExtraUsd;
            virtualBalances.forEach((b: any) => {
              let tokenKey = b.asset_type.toLowerCase().replace(/^0x0*/, '0x');
              if (NATIVE_MOVE_ADDRESSES.has(tokenKey)) {
                tokenKey = '0x1';
              }

              let price = pricesByTime[timeISO][tokenKey] || 0;

              if (price === 0 && b.symbol) {
                const upperSym = b.symbol.toUpperCase();
                if (LST_PRICE_ALIASES[b.symbol]) {
                  const aliasKey = LST_PRICE_ALIASES[b.symbol];
                  price = pricesByTime[timeISO][aliasKey] || fallbackPrices[aliasKey] || 0;
                } else if (upperSym.includes('USDC') || upperSym.includes('USDT') || upperSym.includes('DAI') || upperSym.includes('USDE') || upperSym.includes('USD')) {
                  price = 0;
                } else if (upperSym.includes('BTC')) {
                  const btcKey = '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c';
                  price = pricesByTime[timeISO][btcKey] || fallbackPrices[btcKey] || 0;
                } else if (upperSym.includes('ETH')) {
                  const ethKey = '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376';
                  price = pricesByTime[timeISO][ethKey] || fallbackPrices[ethKey] || 0;
                } else if (upperSym === 'MOVE' || upperSym.includes('MOVE') || tokenKey === '0x1') {
                  price = pricesByTime[timeISO]['0x1'] || pricesByTime[timeISO]['0xa'] || fallbackPrices['0x1'] || 0;
                } else {
                  price = fallbackPrices[tokenKey] || 0;
                }
              }

              if (price === 0 && fallbackPrices[tokenKey]) {
                price = fallbackPrices[tokenKey];
              }

              totalValuation += Number(b.amount || 0) * price;
            });

            return {
              date: timeISO,
              value: totalValuation,
              netDeposits: netDepositsMap[timeISO],
            };
          });

          const history = historyReversed.reverse();

          if (history.length >= 2) {
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
          }
        }
      } catch (err: any) {
        console.error('[Analytics/PNL/1D] Failed dynamic projection, falling back to standard:', err.message);
      }
    }

    const { data: snapshots, error: snapError } = await supabase
      .from('user_networth_snapshots')
      .select('total_networth_usd, wallet_usd, defi_usd, nft_usd, net_deposits_usd, timestamp')
      .eq('user_address', wallet)
      .gte('timestamp', startDate.toISOString())
      .order('timestamp', { ascending: true });

    if (snapError) throw snapError;

    if (!snapshots || snapshots.length === 0) {
      // Before returning empty, check if a sync is in progress for this wallet
      const { data: activeJob } = await supabase
        .from('sync_queue')
        .select('status')
        .eq('user_address', wallet)
        .in('status', ['pending', 'processing'])
        .maybeSingle();

      if (activeJob) {
        const { data: syncStatus } = await supabase
          .from('user_sync_status')
          .select('synced_transactions, total_transactions')
          .eq('user_address', wallet)
          .maybeSingle();

        return res.json({
          history: [],
          performance: { changeUsd: 0, changePercent: 0 },
          syncing: true,
          syncStatus: activeJob.status,
          syncProgress: {
            synced: syncStatus?.synced_transactions || 0,
            total: syncStatus?.total_transactions || 0,
          },
        });
      }

      return res.json({ history: [], performance: { changeUsd: 0, changePercent: 0 } });
    }

    const staticExtraUsd = req.body?.staticExtraUsd !== undefined ? Number(req.body.staticExtraUsd) : null;
    let history: any[] = [];

    if (staticExtraUsd !== null) {
      // Find the latest snapshot that is real-time (has defi_usd > 0 or nft_usd > 0)
      let latestDefi = 0;
      let latestNft = 0;
      for (let i = snapshots.length - 1; i >= 0; i--) {
        const snap = snapshots[i];
        const defi = Number(snap.defi_usd || 0);
        const nft = Number(snap.nft_usd || 0);
        if (defi > 0 || nft > 0) {
          latestDefi = defi;
          latestNft = nft;
          break;
        }
      }

      const missingFrontendNow = Math.max(0, staticExtraUsd - (latestDefi + latestNft));

      history = snapshots.map((s: any) => {
        const defi = Number(s.defi_usd || 0);
        const nft = Number(s.nft_usd || 0);
        const total = Number(s.total_networth_usd || 0);
        let val = total;

        if (defi === 0 && nft === 0) {
          // Backfilled snapshot (wallet tokens only)
          val = total + staticExtraUsd;
        } else {
          // Real-time snapshot (has recorded DeFi/NFTs)
          val = total + missingFrontendNow;
        }

        return {
          date: s.timestamp,
          value: val,
          netDeposits: Number(s.net_deposits_usd || 0),
        };
      });
    } else {
      history = snapshots.map((s: any) => ({
        date: s.timestamp,
        value: Number(s.total_networth_usd),
        netDeposits: Number(s.net_deposits_usd || 0),
      }));
    }

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

import { analyticsCache } from '../services/analyticsCache.ts';

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

    const isCustomDate = Boolean(customStartDate || customEndDate);
    if (!isCustomDate) {
      const cachedData = analyticsCache.get(wallet, timeframe);
      if (cachedData) {
        return res.status(200).json(cachedData);
      }
    }

    const result = await aggregateAnalyticsData(supabase, wallet, timeframe, customStartDate, customEndDate);

    // If no transactions found, check whether a sync is currently in progress
    // and surface that state to the frontend instead of silently returning empty data.
    if (!result.interactionCount && !result.totalVolume) {
      const { data: syncStatus } = await supabase
        .from('user_sync_status')
        .select('full_history_synced, synced_transactions, total_transactions, sync_error')
        .eq('user_address', wallet)
        .maybeSingle();

      const { data: activeJob } = await supabase
        .from('sync_queue')
        .select('status')
        .eq('user_address', wallet)
        .in('status', ['pending', 'processing'])
        .maybeSingle();

      if (activeJob) {
        return res.status(200).json({
          ...result,
          syncing: true,
          syncStatus: activeJob.status,
          syncProgress: {
            synced: syncStatus?.synced_transactions || 0,
            total: syncStatus?.total_transactions || 0,
          },
        });
      }

      if (syncStatus?.sync_error) {
        return res.status(200).json({
          ...result,
          syncing: false,
          syncError: syncStatus.sync_error,
        });
      }
    }

    if (!isCustomDate) {
      analyticsCache.set(wallet, timeframe, result);
    }

    return res.status(200).json(result);
  } catch (err: unknown) {
    if (walletAccessErrorHandler(err, res)) return;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;
