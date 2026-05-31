import { getSupabase } from '../config/supabase.ts';
import express, { Request, Response } from 'express';
import { normalizeAddress } from '../utils/address.ts';
import { generalLimiter } from '../middleware/rateLimit.ts';
import {
  assertEnrichedWalletAccess,
  hasAdvancedTransactionFilters,
  walletAccessErrorHandler,
} from '../middleware/walletAccess.ts';
import { isPremiumTier } from '@daftar/shared-types';

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
  NFT_SALE: 'nft_sale',
  NFT_BUY: 'nft_buy',
  NFT_LIST: 'nft_list',
  NFT_BID: 'nft_bid',
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
  nft_sale: { label: 'Accept Bid', icon: '🎨', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  nft_buy:  { label: 'Buy NFT',    icon: '🖼️', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  nft_list: { label: 'List NFT',   icon: '🏷️', color: '#EC4899', bg: 'rgba(236,72,153,0.1)' },
  nft_bid:  { label: 'Place Bid',  icon: '📥', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  other:    { label: 'Contract', icon: '⚙️', color: '#94A3B8', bg: 'rgba(148,163,184,0.1)' },
};

/**
 * GET /api/transactions
 * Fetch transactions for a wallet from the database
 */
router.get('/', generalLimiter, async (req: Request, res: Response) => {
  const supabaseAdmin = getSupabase();
  const wallet = normalizeAddress((req.query.wallet as string) || (req.query.address as string));
  const page = parseInt((req.query.page as string) || '1');
  const limit = parseInt((req.query.limit as string) || '20');
  const type = req.query.type as string;

  // New advanced filters
  const protocolsRaw = req.query.protocols as string;
  const exactTypesRaw = req.query.exactTypes as string;
  const minAmount = req.query.minAmount ? parseFloat(req.query.minAmount as string) : null;
  const maxAmount = req.query.maxAmount ? parseFloat(req.query.maxAmount as string) : null;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  if (!wallet) return res.status(400).json({ error: 'wallet is required' });
  if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

  try {
    const access = await assertEnrichedWalletAccess(supabaseAdmin, req, wallet);

    if (hasAdvancedTransactionFilters(req) && !isPremiumTier(access.tier)) {
      return res.status(403).json({
        error: 'Advanced transaction filters require an active Pro subscription',
        code: 'WALLET_ACCESS_DENIED',
      });
    }

    let query = supabaseAdmin
      .from('user_transaction_history')
      .select('*', { count: 'exact' })
      .eq('user_address', wallet)
      .order('timestamp', { ascending: false });

    // Legacy type filter for backwards compatibility
    if (type && type !== 'all') {
      if (type === 'transfers') {
        query = query.in('action', ['SEND', 'RECEIVE', 'TRANSFER']);
      } else if (type === 'lending') {
        query = query.in('action', ['BORROW', 'DEPOSIT', 'REPAY', 'WITHDRAW', 'LEND']);
      } else if (type === 'staking') {
        query = query.in('action', ['STAKE', 'UNSTAKE', 'CLAIM']);
      } else {
        query = query.eq('action', type.toUpperCase());
      }
    }

    // Advanced Filters
    if (protocolsRaw) {
      const protocols = protocolsRaw.split(',').map(p => p.trim()).filter(Boolean);
      if (protocols.length > 0) {
        query = query.in('protocol', protocols);
      }
    }

    if (exactTypesRaw) {
      const exactTypes = exactTypesRaw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      if (exactTypes.length > 0) {
        query = query.in('action', exactTypes);
      }
    }

    if (startDate) {
      query = query.gte('timestamp', new Date(startDate).toISOString());
    }

    if (endDate) {
      query = query.lte('timestamp', new Date(endDate).toISOString());
    }

    if (minAmount !== null || maxAmount !== null) {
      // Supabase OR condition for filtering either asset_in_amount OR asset_out_amount
      // e.g., (asset_in_amount >= min OR asset_out_amount >= min)
      let orConditions = [];
      
      if (minAmount !== null && maxAmount !== null) {
        orConditions.push(`and(asset_in_amount.gte.${minAmount},asset_in_amount.lte.${maxAmount})`);
        orConditions.push(`and(asset_out_amount.gte.${minAmount},asset_out_amount.lte.${maxAmount})`);
      } else if (minAmount !== null) {
        orConditions.push(`asset_in_amount.gte.${minAmount}`);
        orConditions.push(`asset_out_amount.gte.${minAmount}`);
      } else if (maxAmount !== null) {
        orConditions.push(`asset_in_amount.lte.${maxAmount}`);
        orConditions.push(`asset_out_amount.lte.${maxAmount}`);
      }

      if (orConditions.length > 0) {
        query = query.or(orConditions.join(','));
      }
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query.range(from, to);

    if (error) throw error;

    const mappedData = (data || []).map(tx => {
      const txType = ACTION_TO_TX_TYPE[tx.action] || 'other';
      const visuals = TX_VISUALS[txType] || TX_VISUALS['other'];

      // Resolve counterparty address from metadata activities
      let counterpartyAddress = null;
      const userAddress = wallet.toLowerCase();
      const rawActivities = [
        ...(tx.metadata?.fungible_asset_activities || []),
        ...(tx.metadata?.coin_activities || [])
      ];
      for (const act of rawActivities) {
        const owner = (act.owner_address || act.owner || '').toLowerCase();
        if (owner && owner !== userAddress && owner !== '0x1' && owner !== '0x3' && owner !== '0xa' && owner !== '0x0000000000000000000000000000000000000000000000000000000000000001') {
          counterpartyAddress = act.owner_address || act.owner;
          break;
        }
      }

      // Resolve dapp_contract from function id
      let dappContract = null;
      const functionId = tx.metadata?.entry_function_id_str || '';
      if (functionId.includes('::')) {
        dappContract = functionId.split('::')[0];
      }

      // Compute USD values based on tx.value_usd and txType
      let amountInUsd = 0;
      let amountOutUsd = 0;
      const usdValue = tx.value_usd != null ? Number(tx.value_usd) : 0;
      if (txType === 'received') {
        amountOutUsd = usdValue;
      } else if (txType === 'send') {
        amountInUsd = usdValue;
      } else if (txType === 'swap') {
        amountInUsd = usdValue;
        amountOutUsd = usdValue;
      } else {
        if (tx.asset_out_amount != null && Number(tx.asset_out_amount) > 0) {
          amountInUsd = usdValue;
        }
        if (tx.asset_in_amount != null && Number(tx.asset_in_amount) > 0) {
          amountOutUsd = usdValue;
        }
        if (amountInUsd === 0 && amountOutUsd === 0 && usdValue > 0) {
          amountInUsd = usdValue;
          amountOutUsd = usdValue;
        }
      }

      return {
        tx_hash: tx.hash,
        tx_timestamp: tx.timestamp,
        tx_type: txType,
        tx_label: tx.description || visuals.label,
        tx_icon: visuals.icon,
        tx_color: visuals.color,
        tx_bg: visuals.bg,
        dapp_name: tx.protocol && tx.protocol !== 'Unknown' ? tx.protocol : (['send', 'received', 'bridge'].includes(txType) ? 'Wallet' : 'Unknown Contract'),
        dapp_key: tx.protocol && tx.protocol !== 'Unknown' ? tx.protocol.toLowerCase().replace(/\s/g, '') : null,
        dapp_contract: dappContract,
        counterparty_address: counterpartyAddress,
        sender: txType === 'received' && counterpartyAddress ? counterpartyAddress : userAddress,
        // token_in is what user SENT/SPENT (outflow = asset_out)
        token_in: tx.asset_out_symbol || null,
        amount_in: tx.asset_out_amount != null ? Number(tx.asset_out_amount) : null,
        // token_out is what user RECEIVED (inflow = asset_in)
        token_out: tx.asset_in_symbol || null,
        amount_out: tx.asset_in_amount != null ? Number(tx.asset_in_amount) : null,
        amount_in_usd: amountInUsd,
        amount_out_usd: amountOutUsd,
        pnl_usd: txType === 'swap' ? 0 : 0, // Swaps are value-balanced, PNL calculated in frontend if needed
        gas_fee: tx.metadata?.gas_used != null && tx.metadata?.gas_unit_price != null
          ? (Number(tx.metadata.gas_used) * Number(tx.metadata.gas_unit_price)) / 1e8
          : (tx.gas_usd != null && Number(tx.gas_usd) < 0.1 ? Number(tx.gas_usd) : null),
        gas_fee_usd: tx.gas_usd || null,
        status: tx.metadata?.success === false ? 'failed' : 'success',
      };
    });

    return res.status(200).json({
      transactions: mappedData,
      total: count || 0,
      page,
      hasMore: (count || 0) > to + 1
    });
  } catch (err: unknown) {
    if (walletAccessErrorHandler(err, res)) return;
    console.error('[Transactions] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
