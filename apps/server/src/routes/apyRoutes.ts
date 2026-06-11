import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response } from 'express';
import { generalLimiter } from '../middleware/rateLimit.ts';

const router = express.Router();

router.get('/', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Supabase client not initialized' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('protocol_apys')
      .select('*')
      .order('protocol', { ascending: true });

    if (error) {
      console.error('[ApyRoutes] Database error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch APY data' });
    }

    return res.json({
      success: true,
      data: data || [],
      updatedAt: data && data.length > 0 ? data[0].updated_at : Date.now()
    });
  } catch (err: any) {
    console.error('[ApyRoutes] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
