import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    const limit = Math.min(parseInt((req.query.limit as string) || '100'), 100);

    const { data: entities } = await supabaseAdmin.from('tracked_entities').select('address');
    const entityAddresses = (entities || []).map(e => e.address.toLowerCase());

    let query = supabaseAdmin
      .from('profiles')
      .select('wallet_address, username, avatar_url, xp')
      .order('xp', { ascending: false });

    if (entityAddresses.length > 0) {
      query = query.filter('wallet_address', 'not.in', `(${entityAddresses.join(',')})`);
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      console.error('[Leaderboard] Supabase Error:', error);
      return res.status(500).json({ error: 'Failed to fetch leaderboard', details: error.message });
    }

    const leaderboardData = Array.isArray(data) ? data : [];

    return res.status(200).json({
      leaderboard: leaderboardData.map(d => ({
        ...d,
        address: d.wallet_address || '',
        walletAddress: d.wallet_address || '',
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

