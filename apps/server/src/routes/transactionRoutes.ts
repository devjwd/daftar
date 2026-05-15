import express, { Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils/address.ts';
import { generalLimiter } from '../middleware/rateLimit.ts';

const router = express.Router();

// Maps server-side action names to frontend tx_type values
const ACTION_TO_TX_TYPE: Record<string, string> = {
  SWAP: 'swap',
  DEPOSIT: 'deposit',
  WITHDRAW: 'withdraw',
  LEND: 'lend',
  BORROW: 'borrow',
  REPAY: 'repay',
  SEND: 'send',
  RECEIVE: 'received',
  STAKE: 'stake',
  UNSTAKE: 'unstake',
  CLAIM: 'claim',
  BRIDGE_IN: 'bridge',
  BRIDGE_OUT: 'bridge',
  OTHER: 'other',
};

// Visual config to match frontend TX_VISUALS
const TX_VISUALS: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  swap:     { label: 'Swap',     icon: '⇄',  color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)' },
  send:     { label: 'Send',     icon: '↗',  color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  received: { label: 'Receive',  icon: '↙',  color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  stake:    { label: 'Stake',    icon: '🔒', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  unstake:  { label: 'Unstake',  icon: '🔓', color: '#6366F1', bg: 'rgba(99,102,241,0.1)' },
  lend:     { label: 'Lend',     icon: '🏦', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  borrow:   { label: 'Borrow',   icon: '💸', color: '#EC4899', bg: 'rgba(236,72,153,0.1)' },
  repay:    { label: 'Repay',    icon: '💰', color: '#14B8A6', bg: 'rgba(20,184,166,0.1)' },
  deposit:  { label: 'Deposit',  icon: '📥', color: '#06B6D4', bg: 'rgba(6,182,212,0.1)' },
  withdraw: { label: 'Withdraw', icon: '📤', color: '#F97316', bg: 'rgba(249,115,22,0.1)' },
  claim:    { label: 'Claim',    icon: '🎁', color: '#FACC15', bg: 'rgba(250,204,21,0.1)' },
  bridge:   { label: 'Bridge',   icon: '🌉', color: '#64748B', bg: 'rgba(100,116,139,0.1)' },
  other:    { label: 'Contract', icon: '⚙️', color: '#94A3B8', bg: 'rgba(148,163,184,0.1)' },
};

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
      .from('user_transaction_history')
      .select('*', { count: 'exact' })
      .eq('user_address', wallet)
      .order('timestamp', { ascending: false });

    if (type && type !== 'all') {
      if (type === 'transfers') {
        query = query.in('action', ['SEND', 'RECEIVE', 'TRANSFER']);
      } else if (type === 'lending') {
        query = query.in('action', ['BORROW', 'DEPOSIT', 'REPAY', 'WITHDRAW']);
      } else if (type === 'staking') {
        query = query.in('action', ['STAKE', 'UNSTAKE', 'CLAIM']);
      } else {
        query = query.eq('action', type.toUpperCase());
      }
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    const mappedData = (data || []).map(tx => {
      const txType = ACTION_TO_TX_TYPE[tx.action] || 'other';
      const visuals = TX_VISUALS[txType] || TX_VISUALS['other'];

      return {
        tx_hash: tx.hash,
        tx_timestamp: tx.timestamp,
        tx_type: txType,
        tx_label: tx.description || visuals.label,
        tx_icon: visuals.icon,
        tx_color: visuals.color,
        tx_bg: visuals.bg,
        dapp_name: tx.protocol && tx.protocol !== 'Unknown' ? tx.protocol : 'Unknown Contract',
        // token_in is what user SENT/SPENT (outflow = asset_out)
        token_in: tx.asset_out_symbol || null,
        amount_in: tx.asset_out_amount != null ? Number(tx.asset_out_amount) : null,
        // token_out is what user RECEIVED (inflow = asset_in)
        token_out: tx.asset_in_symbol || null,
        amount_out: tx.asset_in_amount != null ? Number(tx.asset_in_amount) : null,
        gas_fee: tx.gas_usd || null,
        status: tx.metadata?.success === false ? 'failed' : 'success',
      };
    });

    return res.status(200).json({
      transactions: mappedData,
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
