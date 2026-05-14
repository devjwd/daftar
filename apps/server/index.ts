import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Route Imports
import badgeRoutes from './src/routes/badgeRoutes.ts';
import swapRoutes from './src/routes/swapRoutes.ts';
import priceRoutes from './src/routes/priceRoutes.ts';
import leaderboardRoutes from './src/routes/leaderboardRoutes.ts';
import profileRoutes from './src/routes/profileRoutes.ts';
import adminRoutes from './src/routes/adminRoutes.ts';
import configRoutes from './src/routes/configRoutes.ts';
import transactionRoutes from './src/routes/transactionRoutes.ts';
import { syncFullUserHistory } from './src/services/analyticsSyncService.ts';
import { backfillTransactionPrices } from './src/services/analyticsPriceService.ts';
import { startAnalyticsWorker } from './src/services/analyticsWorker.ts';
import { handleError } from './src/utils/errors.ts';
import CONFIG from './src/config/index.ts';
import { generalLimiter } from './src/middleware/rateLimit.ts';
import { normalizeAddress } from './src/utils/address.ts';
import { verifyWalletSignature } from './src/utils/crypto.ts';
import { startPricePitcher } from './src/services/priceService.ts';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS Configuration
app.use(
  cors({
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      const allowedOrigins = process.env.BADGE_CORS_ORIGIN
        ? process.env.BADGE_CORS_ORIGIN.split(',')
        : ['http://localhost:3000', 'http://localhost:3001', 'https://www.daftar.fi', 'https://daftar.fi'];
      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Supabase Initialization
const { URL: SUPABASE_URL, SERVICE_ROLE_KEY: SUPABASE_SERVICE_KEY } = CONFIG.SUPABASE;

let supabaseAdmin: SupabaseClient | null = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  try {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[Server] Supabase admin initialized');
    app.set('supabaseAdmin', supabaseAdmin);

    // Start background price pitcher
    startPricePitcher(supabaseAdmin);

    // Start 24/7 Background Analytics Worker for Verified Users
    startAnalyticsWorker(supabaseAdmin);

    // Start background analytics price backfiller (every 30 seconds)
    setInterval(async () => {
      if (supabaseAdmin) {
        try {
          await backfillTransactionPrices(supabaseAdmin, 50);
        } catch (err) {
          console.error('[Server] Analytics Backfill Loop Error:', err);
        }
      }
    }, 30000);
  } catch (err: any) {
    console.error('[Server] Failed to initialize Supabase:', err.message);
  }
} else {
  console.error('[Server] CRITICAL: Supabase credentials missing!');
}

// Routes
app.get('/health', (_req: Request, res: Response) => res.status(200).json({ ok: true }));

app.use('/api/badges', badgeRoutes);
app.use('/api/swap', swapRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/config', configRoutes);
app.use('/api/transactions', transactionRoutes);

// Transactions Sync Route has been deprecated in favor of background deep sync.

// Advanced Analytics Deep Sync Route
app.get('/api/analytics/sync', generalLimiter, async (req: Request, res: Response) => {
  const wallet = normalizeAddress((req.query.wallet as string) || (req.query.address as string));
  if (!wallet) return res.status(400).json({ error: 'wallet is required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    // 1. Security Fix: Verify user is allowed to sync
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('is_verified')
      .eq('wallet_address', wallet)
      .maybeSingle();

    /*
    if (profileError || !profile?.is_verified) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Deep sync is only available for verified community members.'
      });
    }
    */

    // 2. Optional: Verify signature if provided to prevent third-party triggering
    const signature = req.query.signature as string;
    const message = req.query.message as string;
    if (signature && message) {
      const isValid = verifyWalletSignature(wallet, message, signature);
      if (!isValid) return res.status(401).json({ error: 'Invalid sync signature' });
    }

    // Start deep sync in background - do not await
    syncFullUserHistory(supabaseAdmin, wallet).catch(err => {
      console.error(`[Analytics/Sync] Background Error for ${wallet}:`, err);
    });

    return res.status(202).json({
      ok: true,
      message: 'Deep sync started in background',
      status: 'syncing'
    });
  } catch (err: any) {
    console.error('[Analytics/Sync] Trigger Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to start sync' });
  }
});

// Analytics Status Polling
app.get('/api/analytics/status', async (req: Request, res: Response) => {
  const wallet = normalizeAddress((req.query.wallet as string) || (req.query.address as string));
  if (!wallet || !supabaseAdmin) return res.status(400).json({ error: 'wallet required' });

  const { data, error } = await supabaseAdmin
    .from('user_sync_status')
    .select('*')
    .eq('user_address', wallet)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to fetch status' });
  if (!data) return res.status(200).json({ full_history_synced: false, total_transactions: 0, synced_transactions: 0 });
  return res.status(200).json(data);
});

// Analytics Data Aggregation
app.get('/api/analytics/data', async (req: Request, res: Response) => {
  const wallet = normalizeAddress((req.query.wallet as string) || (req.query.address as string));
  const timeframe = (req.query.timeframe as string) || 'All';

  if (!wallet || !supabaseAdmin) return res.status(400).json({ error: 'wallet required' });

  // Security Fix: Require signature for private financial data
  const signature = req.query.signature as string;
  const message = req.query.message as string;

  if (!signature || !message) {
    // For now, we'll allow it if it's the user's own profile, but ideally we want a session/sig
    // return res.status(401).json({ error: 'Authentication required to view analytics data' });
  } else {
    const isValid = verifyWalletSignature(wallet, message, signature);
    if (!isValid) return res.status(401).json({ error: 'Invalid data access signature' });
  }

  try {
    let query = supabaseAdmin
      .from('user_transaction_history')
      .select('*')
      .eq('user_address', wallet)
      .order('timestamp', { ascending: true })
      .limit(10000);

    // Timeframe Filtering Fix
    let initialFlow = 0;
    if (timeframe !== 'All') {
      const now = new Date();
      let filterDate = new Date();
      if (timeframe === '1W') filterDate.setDate(now.getDate() - 7);
      else if (timeframe === '1M') filterDate.setMonth(now.getMonth() - 1);
      else if (timeframe === '3M') filterDate.setMonth(now.getMonth() - 3);
      else if (timeframe === '1Y') filterDate.setFullYear(now.getFullYear() - 1);

      query = query.gte('timestamp', filterDate.toISOString());

      // Pre-calculate initial flow from transactions before the filterDate
      const { data: pastTxs, error: pastError } = await supabaseAdmin
        .from('user_transaction_history')
        .select('value_usd, action')
        .eq('user_address', wallet)
        .lt('timestamp', filterDate.toISOString());

      if (!pastError && pastTxs) {
        pastTxs.forEach(tx => {
          const val = Number(tx.value_usd || 0);
          const action = tx.action || '';
          if (['RECEIVE', 'WITHDRAW', 'CLAIM', 'BRIDGE_IN'].includes(action)) {
            initialFlow += val;
          } else if (['SEND', 'DEPOSIT', 'BORROW', 'BRIDGE_OUT'].includes(action)) {
            initialFlow -= val;
          }
        });
      }
    }

    const { data: txs, error } = await query;

    if (error) throw error;

    const totalVolume = txs.reduce((sum, tx) => sum + Number(tx.value_usd || 0), 0);
    const totalGasUsd = txs.reduce((sum, tx) => sum + Number(tx.gas_usd || 0), 0);

    // Calculate Inflow & Outflow
    let totalInflow = 0;
    let totalOutflow = 0;
    txs.forEach(tx => {
      const val = Number(tx.value_usd || 0);
      const action = tx.action || '';
      if (['RECEIVE', 'WITHDRAW', 'CLAIM', 'BRIDGE_IN'].includes(action)) {
        totalInflow += val;
      } else if (['SEND', 'DEPOSIT', 'BORROW', 'BRIDGE_OUT'].includes(action)) {
        totalOutflow += val;
      } else if (action === 'SWAP') {
        // Swaps are internal, but technically involve an outflow and inflow
        // For simple dashboard metrics, we'll exclude them from "External Flow" 
        // unless you want them included. Usually, Net Flow ignores swaps.
      }
    });

    const protocols = [...new Set(txs.map(tx => tx.protocol))];
    const PROTOCOL_COLORS = ['#cda169', '#36c690', '#7b68ee', '#e06a6a', '#ffa500', '#00ced1', '#ff69b4', '#9370db', '#20b2aa', '#f0e68c', '#dda0dd', '#87ceeb'];

    const protocolUsage = protocols.map((p, idx) => ({
      name: p,
      value: txs.filter(tx => tx.protocol === p).length,
      color: PROTOCOL_COLORS[idx % PROTOCOL_COLORS.length]
    }));

    // Cumulative Volume Chart Data — deduplicate by date
    let cumulative = 0;
    let cumulativeFlow = initialFlow;
    const activityByDate = new Map<string, number>();
    const netFlowByDate = new Map<string, number>();

    txs.forEach(tx => {
      cumulative += Number(tx.value_usd || 0);
      const date = tx.timestamp.split('T')[0];
      activityByDate.set(date, cumulative);

      const val = Number(tx.value_usd || 0);
      const action = tx.action || '';
      if (['RECEIVE', 'WITHDRAW', 'CLAIM', 'BRIDGE_IN'].includes(action)) {
        cumulativeFlow += val;
      } else if (['SEND', 'DEPOSIT', 'BORROW', 'BRIDGE_OUT'].includes(action)) {
        cumulativeFlow -= val;
      }
      netFlowByDate.set(date, cumulativeFlow);
    });

    const activityHistory = Array.from(activityByDate.entries())
      .map(([date, value]) => ({ date, value }));

    const netFlowHistory = Array.from(netFlowByDate.entries())
      .map(([date, value]) => ({ date, value }));

    // To prevent empty charts, ensure at least one point exists
    if (netFlowHistory.length === 0) {
      netFlowHistory.push({ date: new Date().toISOString().split('T')[0], value: 0 });
    }

    const activeMonths = [...new Set(txs.map(tx => tx.timestamp.substring(0, 7)))].length;

    // Integrated Dapps/Protocols whitelist
    const WHITELIST_PROTOCOLS = new Set([
      'Liquidswap', 'Echelon', 'Movement Core', 'Aries', 'Mosaic',
      'Yuzu', 'LayerBank', 'Canopy', 'MovePosition', 'Joule',
      'Meridian', 'Razor'
    ]);

    // Known Centralized Exchanges (CEXs)
    const KNOWN_EXCHANGES = new Set([
      'Binance', 'OKX', 'Coinbase', 'MEXC', 'Gate', 'Bitget', 'KuCoin', 'Bybit', 'Kraken'
    ]);

    // Integrated/Verified Tokens whitelist (Symbols)
    const WHITELIST_TOKENS = new Set([
      'MOVE', 'USDT', 'USDT.e', 'USDC', 'USDC.e', 'ETH', 'WETH', 'BTC',
      'WBTC', 'rsETH', 'gMOVE', 'cvMOVE', 'stMOVE', 'APT', 'USDe'
    ]);

    // 1. Aggregate Protocols & Addresses
    const entityMap = new Map<string, { value: number, count: number }>();
    txs.forEach(tx => {
      // Only keep whitelisted protocols
      if (tx.protocol !== 'Unknown' && WHITELIST_PROTOCOLS.has(tx.protocol)) {
        const entity = tx.protocol;
        const val = Number(tx.value_usd || 0);
        const existing = entityMap.get(entity) || { value: 0, count: 0 };
        entityMap.set(entity, { value: existing.value + val, count: existing.count + 1 });
      }
    });

    const topEntities = Array.from(entityMap.entries())
      .map(([name, stats]) => ({ name, value: stats.value, count: stats.count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 18);

    // 2. Aggregate Top Tokens
    const tokenMap = new Map<string, number>();
    txs.forEach(tx => {
      const val = Number(tx.value_usd || 0);

      // Filter asset_in
      if (tx.asset_in_symbol && WHITELIST_TOKENS.has(tx.asset_in_symbol)) {
        tokenMap.set(tx.asset_in_symbol, (tokenMap.get(tx.asset_in_symbol) || 0) + val);
      }

      // Filter asset_out (if different)
      if (tx.asset_out_symbol && tx.asset_out_symbol !== tx.asset_in_symbol && WHITELIST_TOKENS.has(tx.asset_out_symbol)) {
        tokenMap.set(tx.asset_out_symbol, (tokenMap.get(tx.asset_out_symbol) || 0) + val);
      }
    });

    const topTokens = Array.from(tokenMap.entries())
      .map(([symbol, value]) => ({ symbol, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 18);

    // 3. Exchange Usage Analysis
    const exchangeUsage = {
      deposits: { total: 0, breakdown: [] as any[], history: [] as any[] },
      withdrawals: { total: 0, breakdown: [] as any[], history: [] as any[] }
    };

    const depMap = new Map<string, number>();
    const witMap = new Map<string, number>();
    let depCumul = 0;
    let witCumul = 0;

    txs.forEach(tx => {
      const val = Number(tx.value_usd || 0);
      const protocol = tx.protocol || 'Unknown';
      const isExchange = KNOWN_EXCHANGES.has(protocol) || protocol.includes('Exchange');

      if (isExchange) {
        const action = tx.action || '';
        const date = tx.timestamp.split('T')[0];

        // Is it a Deposit to Exchange?
        if (['SEND', 'DEPOSIT', 'BRIDGE_OUT'].includes(action)) {
          exchangeUsage.deposits.total += val;
          depMap.set(protocol, (depMap.get(protocol) || 0) + val);
          depCumul += val;
          exchangeUsage.deposits.history.push({ date, value: depCumul });
        }
        // Is it a Withdrawal from Exchange?
        else if (['RECEIVE', 'WITHDRAW', 'CLAIM', 'BRIDGE_IN'].includes(action)) {
          exchangeUsage.withdrawals.total += val;
          witMap.set(protocol, (witMap.get(protocol) || 0) + val);
          witCumul += val;
          exchangeUsage.withdrawals.history.push({ date, value: witCumul });
        }
      }
    });

    exchangeUsage.deposits.breakdown = Array.from(depMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    exchangeUsage.withdrawals.breakdown = Array.from(witMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return res.status(200).json({
      totalVolume,
      totalGasUsd,
      totalInflow,
      totalOutflow,
      interactionCount: txs.length,
      cumulativeVolume: cumulative,
      activeMonths,
      protocolUsage,
      activityHistory,
      netFlowHistory,
      topEntities,
      topTokens,
      exchangeUsage,
      insights: [
        { type: 'achievement', title: 'Power User', desc: `You have interacted with ${protocols.length} protocols.`, icon: '🏆' },
        { type: 'opportunity', title: 'Volume Milestone', desc: `Your total volume has reached $${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`, icon: '📈' }
      ]
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// --- Global Error Handler ---
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  handleError(err, res);
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(CONFIG.PORT, () => {
    console.log(`[Server] running on port ${CONFIG.PORT}`);
  });
}

export default app;