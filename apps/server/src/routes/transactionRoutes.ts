import express, { Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';
import { generalLimiter } from '../middleware/rateLimit.ts';

const router = express.Router();

/**
 * GET /api/transactions
 * Fetch transactions for a wallet from the database
 */
router.get('/', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = req.app.get('supabaseAdmin') as SupabaseClient;
  const wallet = normalizeAddress((req.query.wallet as string) || (req.query.address as string));
  const page = parseInt((req.query.page as string) || '1');
  const limit = parseInt((req.query.limit as string) || '20');
  const type = req.query.type as string;

  if (!wallet) return res.status(400).json({ error: 'wallet is required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    let query = supabaseAdmin
      .from('transaction_history')
      .select('*', { count: 'exact' })
      .eq('wallet_address', wallet)
      .order('tx_timestamp', { ascending: false });

    if (type && type !== 'all') {
      if (type === 'transfers') {
        query = query.in('tx_type', ['transfer', 'received', 'send']);
      } else if (type === 'lending') {
        query = query.in('tx_type', ['lend', 'borrow', 'repay', 'deposit', 'withdraw', 'liquidity']);
      } else if (type === 'staking') {
        query = query.in('tx_type', ['stake', 'unstake', 'claim']);
      } else {
        query = query.eq('tx_type', type);
      }
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    return res.status(200).json({
      transactions: data || [],
      total: count || 0,
      page,
      hasMore: (count || 0) > to + 1
    });
  } catch (err: any) {
    console.error('[Transactions] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
