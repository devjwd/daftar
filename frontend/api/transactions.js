import { createClient } from '@supabase/supabase-js';

import { handleOptions, methodNotAllowed, sendJson, setApiHeaders } from './_lib/http.js';
import { loadState } from './_lib/state.js';
import {
  CACHE_TTL_MS,
  filterTransactionsByType,
  getOrFetchTransactions,
  TRANSACTION_HISTORY_LIMIT,
} from '../src/services/transactionService.js';

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

const buildLatestFetchQuery = ({ supabase, wallet }) => supabase
  .from('transaction_history')
  .select('fetched_at')
  .eq('wallet_address', wallet)
  .order('tx_timestamp', { ascending: false })
  .limit(1)
  .maybeSingle();

const buildProfileQuery = ({ supabase, wallet }) => supabase
  .from('profiles')
  .select('wallet_address')
  .eq('wallet_address', wallet)
  .limit(1)
  .maybeSingle();

const isCacheFresh = (fetchedAt) => {
  const fetchedTime = new Date(fetchedAt || 0).getTime();
  return Number.isFinite(fetchedTime) && fetchedTime > 0 && (Date.now() - fetchedTime) < CACHE_TTL_MS;
};

const hasBadgeAwards = async (wallet) => {
  const { userAwards } = await loadState();
  const awards = userAwards?.[wallet];
  return Array.isArray(awards) && awards.length > 0;
};

const isCacheEligibleWallet = async ({ supabase, wallet }) => {
  const profileResult = await buildProfileQuery({ supabase, wallet });
  if (profileResult.error) {
    return { ok: false, error: profileResult.error };
  }

  if (profileResult.data?.wallet_address) {
    return { ok: true, eligible: true, reason: 'profile' };
  }

  try {
    const eligible = await hasBadgeAwards(wallet);
    return { ok: true, eligible, reason: eligible ? 'badge' : 'search-only' };
  } catch (error) {
    return { ok: false, error };
  }
};

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

const clampPageToStoredHistory = (page) => {
  const maxPage = Math.max(1, Math.ceil(TRANSACTION_HISTORY_LIMIT / PAGE_SIZE));
  return Math.min(page, maxPage);
};

const formatLiveTransactionsResponse = ({ rows, type, page }) => {
  const filteredRows = filterTransactionsByType(rows, type);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE;
  const pageRows = filteredRows.slice(from, to);

  return formatTransactionsResponse({
    rows: pageRows,
    total: filteredRows.length,
    page,
  });
};

export default async function handler(req, res) {
  if (handleOptions(req, res, METHODS)) return;
  setApiHeaders(req, res, METHODS);

  if (req.method !== 'GET') {
    return methodNotAllowed(res, req.method, METHODS);
  }

  try {
    const wallet = normalizeWallet(req.query.wallet);
    const requestedPage = clampPageToStoredHistory(normalizePage(req.query.page));
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

    const eligibilityResult = await isCacheEligibleWallet({ supabase, wallet });
    if (!eligibilityResult.ok) {
      console.error('[transactions] failed to determine cache eligibility', eligibilityResult.error);
      return sendJson(res, 500, { error: 'Failed to fetch transactions' });
    }

    if (!eligibilityResult.eligible) {
      const liveTransactions = await getOrFetchTransactions(wallet, {
        persist: false,
        allowCachedRead: false,
        limit: TRANSACTION_HISTORY_LIMIT,
      });

      return sendJson(res, 200, formatLiveTransactionsResponse({
        rows: liveTransactions,
        type,
        page,
      }));
    }

    const { data: latestFetchRow, error: latestFetchError } = await buildLatestFetchQuery({
      supabase,
      wallet,
    });

    if (latestFetchError) {
      console.error('[transactions] failed to check cached transactions', latestFetchError);
      return sendJson(res, 500, { error: 'Failed to fetch transactions' });
    }

    if (!isCacheFresh(latestFetchRow?.fetched_at)) {
      await getOrFetchTransactions(wallet, {
        persist: true,
        allowCachedRead: true,
        limit: TRANSACTION_HISTORY_LIMIT,
      });
      if (!latestFetchRow?.fetched_at) {
        page = 1;
      }
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