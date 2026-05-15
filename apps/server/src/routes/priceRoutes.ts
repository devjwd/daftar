import express, { Request, Response } from 'express';
import { generalLimiter } from '../middleware/rateLimit.ts';
import { fetchCoinGeckoPrices, FALLBACK_PRICES } from '../services/priceService.ts';

const router = express.Router();

interface PriceSnapshot {
  prices: Record<string, number>;
  priceChanges: Record<string, number>;
  updatedAt: number;
}

let cachedSnapshot: PriceSnapshot = {
  prices: { ...FALLBACK_PRICES },
  priceChanges: {},
  updatedAt: 0,
};

router.get('/', generalLimiter, async (req: Request, res: Response) => {
  const now = Date.now();
  const CACHE_TTL = 300000;

  if (cachedSnapshot.updatedAt && now - cachedSnapshot.updatedAt < CACHE_TTL) {
    return res.json({ ...cachedSnapshot, source: 'cache' });
  }

  const supabaseAdmin = req.app.get('supabaseAdmin');
  const live = await fetchCoinGeckoPrices(supabaseAdmin);
  if (live) {
    cachedSnapshot = { ...live, updatedAt: now };
    return res.json({ ...cachedSnapshot, source: 'coingecko' });
  }

  return res.json({ ...cachedSnapshot, source: 'stale-cache', warning: 'Live refresh failed' });
});

router.get('/nft', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin');
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Supabase client not initialized' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('nft_collection_stats')
      .select('*');

    if (error) throw error;

    return res.json({
      collections: data || [],
      updatedAt: data && data.length > 0 ? data[0].updated_at : null
    });
  } catch (err: any) {
    console.error('[PriceRoutes/NFT] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;

