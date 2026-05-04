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
import storageRoutes from './src/routes/storageRoutes.ts';
import configRoutes from './src/routes/configRoutes.ts';

// Service Imports
import { syncUserTransactions } from './src/services/syncService.ts';
import { handleError } from './src/utils/errors.ts';
import CONFIG from './src/config/index.ts';
import { generalLimiter } from './src/middleware/rateLimit.ts';
import { normalizeAddress } from './src/utils/address.ts';

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
app.use('/api/storage', storageRoutes);
app.use('/api/config', configRoutes);

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