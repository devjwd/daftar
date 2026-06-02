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
import analyticsRoutes from './src/routes/analyticsRoutes.ts';
import plansRoutes from './src/routes/plansRoutes.ts';
import feedbackRoutes from './src/routes/feedbackRoutes.ts';
import reportRoutes from './src/routes/reportRoutes.ts';
import { backfillTransactionPrices } from './src/services/analyticsPriceService.ts';
import { startAnalyticsWorker } from './src/services/analyticsWorker.ts';
import { handleError } from './src/utils/errors.ts';
import CONFIG from './src/config/index.ts';
import { startPricePitcher } from './src/services/priceService.ts';
import { startNFTPriceWorker } from './src/services/nftPriceWorker.ts';

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
      // Strict matching for subdomains, removing the loose .endsWith('.vercel.app')
      if (!origin || allowedOrigins.includes(origin) || /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

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

app.use('/api/analytics', analyticsRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/reports', reportRoutes);

// --- Global Error Handler ---
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  handleError(err, res);
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(CONFIG.PORT, async () => {
    console.log(`[Server] running on port ${CONFIG.PORT}`);
    
    // Start background sync queue worker inline (fallback in case separate worker process is not running)
    const { getSupabase } = await import('./src/config/supabase.ts');
    const { processSyncQueue } = await import('./src/services/analyticsSyncQueue.ts');
    const supabaseAdmin = getSupabase();
    
    let isSyncQueueRunning = false;
    setInterval(async () => {
      if (!isSyncQueueRunning) {
        isSyncQueueRunning = true;
        try {
          await processSyncQueue(supabaseAdmin);
        } catch (err) {
          console.error('[Server] Inline Sync Queue Worker Error:', err);
        } finally {
          isSyncQueueRunning = false;
        }
      }
    }, 8000); // Poll sync queue every 8 seconds
  });
}

export default app;