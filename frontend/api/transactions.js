import { createClient } from '@supabase/supabase-js';

import { handleOptions, methodNotAllowed, sendJson, setApiHeaders } from './_lib/http.js';
import { getOrFetchTransactions } from '../src/services/transactionService.js';

const METHODS = ['GET', 'OPTIONS'];
const PAGE_SIZE = 50;
const ALLOWED_TYPES = new Set(['all', 'swap', 'deposit', 'withdraw']);
const TRANSACTION_FIELDS = [
  'tx_hash',
  'tx_type',
  'token_in',
  'token_out',
  'amount_in',
  'amount_out',
  'amount_in_usd',
  'amount_out_usd',
  'pnl_usd',
  'gas_fee',
  'status',
  'tx_timestamp',
].join(', ');

const createSupabaseAdmin = (supabaseUrl, supabaseKey) => {
  try {
    return {
      ok: true,
      supabase: createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }),
    };
  } catch (error) {
    console.error('[transactions] failed to initialize supabase client', error);
    return { ok: false, error: 'Failed to initialize Supabase client' };
  }
};

const normalizeWallet = (wallet) => String(wallet || '').trim().toLowerCase();

const isValidWalletParam = (wallet) => {
  const value = normalizeWallet(wallet);
  return value.startsWith('0x') && value.length > 2;
};

const normalizePage = (page) => {
  const value = Number(page);
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
};

const normalizeType = (type) => {
  const value = String(type || 'all').trim().toLowerCase();
  return ALLOWED_TYPES.has(value) ? value : 'all';
};

const buildTransactionsQuery = ({ supabase, wallet, type, page }) => {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('transaction_history')
    .select(TRANSACTION_FIELDS, { count: 'exact' })
    .eq('wallet_address', wallet)
    .order('tx_timestamp', { ascending: false })
    .range(from, to);

  if (type !== 'all') {
    query = query.eq('tx_type', type);
  }

  return query;
};

const buildExistenceQuery = ({ supabase, wallet }) => supabase
  .from('transaction_history')
  .select('tx_hash', { count: 'exact', head: true })
  .eq('wallet_address', wallet);

const formatTransactionsResponse = ({ rows, total, page }) => ({
  transactions: Array.isArray(rows) ? rows.map((row) => ({
    tx_hash: row.tx_hash,
    tx_type: row.tx_type,
    token_in: row.token_in,
    token_out: row.token_out,
    amount_in: row.amount_in,
    amount_out: row.amount_out,
    amount_in_usd: row.amount_in_usd,
    amount_out_usd: row.amount_out_usd,
    pnl_usd: row.pnl_usd,
    gas_fee: row.gas_fee,
    status: row.status,
    tx_timestamp: row.tx_timestamp,
  })) : [],
  total,
  page,
  hasMore: (page * PAGE_SIZE) < total,
});

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  try {
    const wallet = normalizeWallet(req.query.wallet);
    const requestedPage = normalizePage(req.query.page);
    const type = normalizeType(req.query.type);
    const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
    const supabaseKey = String(process.env.SUPABASE_SERVICE_KEY || '').trim();

    if (!wallet || !isValidWalletParam(wallet)) {
      return sendJson(res, 400, { error: 'Missing or invalid wallet query parameter' });
    }

    if (!supabaseUrl) {
      console.error('SUPABASE_URL is not set');
      return sendJson(res, 500, { error: 'Server configuration error' });
    }

    if (!supabaseKey) {
      console.error('SUPABASE_SERVICE_KEY is not set');
      return sendJson(res, 500, { error: 'Server configuration error' });
    }

    const supabaseResult = createSupabaseAdmin(supabaseUrl, supabaseKey);
    if (!supabaseResult.ok) {
      return sendJson(res, 500, { error: supabaseResult.error });
    }

    const supabase = supabaseResult.supabase;
    let page = requestedPage;

    const { count: existingCount, error: existenceError } = await buildExistenceQuery({
      supabase,
      wallet,
    });

    if (existenceError) {
      console.error('[transactions] failed to check existing transactions', existenceError);
      return sendJson(res, 500, { error: 'Failed to fetch transactions' });
    }

    if (!existingCount) {
      await getOrFetchTransactions(wallet);
      page = 1;
    }

    const { data, count, error } = await buildTransactionsQuery({
      supabase,
      wallet,
      type,
      page,
    });

    if (error) {
      console.error('[transactions] failed to query transactions', error);
      return sendJson(res, 500, { error: 'Failed to fetch transactions' });
    }

    return sendJson(res, 200, formatTransactionsResponse({
      rows: data,
      total: Number(count || 0),
      page,
    }));
  } catch (error) {
    console.error('[transactions] request failed', error);
    return sendJson(res, 500, { error: 'Failed to fetch transactions' });
  }
}