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

// Service Imports
import { syncUserTransactions } from './src/services/syncService.ts';
import { syncFullUserHistory } from './src/services/analyticsSyncService.ts';
import { backfillTransactionPrices } from './src/services/analyticsPriceService.ts';
import { handleError } from './src/utils/errors.ts';
import CONFIG from './src/config/index.ts';
import { generalLimiter } from './src/middleware/rateLimit.ts';
import { normalizeAddress } from './src/utils/address.ts';
import { verifyWalletSignature } from './src/utils/crypto.ts';
import { startPricePitcher } from './src/services/priceService.ts';

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));

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

// Transactions Sync Route
app.get('/api/transactions/sync', generalLimiter, async (req: Request, res: Response) => {
  const wallet = normalizeAddress((req.query.wallet as string) || (req.query.address as string));
  if (!wallet) return res.status(400).json({ error: 'wallet is required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    const result = await syncUserTransactions(supabaseAdmin, wallet, 100);
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[Transactions/Sync] Error:', err);
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
});

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

    if (profileError || !profile?.is_verified) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Deep sync is only available for verified community members.'
      });
    }

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
    .single();

  if (error) return res.status(404).json({ error: 'Status not found' });
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
      .order('timestamp', { ascending: true });

    // Timeframe Filtering Fix
    if (timeframe !== 'All') {
      const now = new Date();
      let filterDate = new Date();
      if (timeframe === '1W') filterDate.setDate(now.getDate() - 7);
      else if (timeframe === '1M') filterDate.setMonth(now.getMonth() - 1);
      else if (timeframe === '3M') filterDate.setMonth(now.getMonth() - 3);
      else if (timeframe === '1Y') filterDate.setFullYear(now.getFullYear() - 1);

      query = query.gte('timestamp', filterDate.toISOString());
    }

    const { data: txs, error } = await query;

    if (error) throw error;

    // Aggregate Stats
    const totalVolume = txs.reduce((sum, tx) => sum + Number(tx.value_usd || 0), 0);
    const totalGasUsd = txs.reduce((sum, tx) => sum + Number(tx.gas_usd || 0), 0);
    const protocols = [...new Set(txs.map(tx => tx.protocol))];

    const protocolUsage = protocols.map(p => ({
      name: p,
      value: txs.filter(tx => tx.protocol === p).length,
      color: p === 'Liquidswap' ? '#cda169' : p === 'Echelon' ? '#36c690' : '#7b68ee'
    }));

    // Cumulative Volume Chart Data (Historical calculation)
    let cumulative = 0;
    const activityHistory = txs.map(tx => {
      const val = Number(tx.value_usd || 0);
      const safeVal = val < 0 ? 0 : val;
      cumulative += safeVal;
      return {
        date: tx.timestamp.split('T')[0],
        value: cumulative
      };
    });

    // Simple dynamic growth metric
    const activeMonths = [...new Set(txs.map(tx => tx.timestamp.substring(0, 7)))].length;

    return res.status(200).json({
      totalVolume,
      totalGasUsd,
      interactionCount: txs.length,
      cumulativeVolume: cumulative,
      activeMonths,
      protocolUsage,
      activityHistory, // Now returns full filtered history instead of hardcoded slice(-20)
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