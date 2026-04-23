import { createClient } from '@supabase/supabase-js';

import { handleOptions, methodNotAllowed, sendJson, setApiHeaders } from './_lib/http.js';
import { loadState } from './_lib/state.js';
import {
  CACHE_TTL_MS,
  filterTransactionsByType,
  getOrFetchTransactions,
} from '../src/services/transactionService.js';

const TRANSACTION_HISTORY_LIMIT = 100;

const METHODS = ['GET', 'OPTIONS'];
const PAGE_SIZE = 20;
const ALLOWED_TYPES = new Set(['all', 'swap', 'deposit', 'withdraw', 'lending', 'staking', 'transfers', 'lend', 'borrow', 'repay', 'stake', 'unstake', 'claim', 'transfer', 'received']);
const TRANSACTION_FIELDS = [
  'tx_hash',
  'tx_type',
  'dapp_key',
  'dapp_name',
  'dapp_logo',
  'dapp_website',
  'dapp_contract',
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

const TYPE_FILTER_GROUPS = {
  lending: ['lend', 'borrow', 'repay'],
  staking: ['stake', 'unstake', 'claim'],
  transfers: ['transfer', 'received'],
  defi: ['deposit', 'withdraw', 'lend', 'borrow', 'repay'],
};

const _buildTransactionsQuery = ({ supabase, wallet, type, page }) => {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('transaction_history')
    .select(TRANSACTION_FIELDS, { count: 'exact' })
    .eq('wallet_address', wallet)
    .order('tx_timestamp', { ascending: false })
    .range(from, to);

  if (type !== 'all') {
    const group = TYPE_FILTER_GROUPS[type];
    if (group) {
      query = query.in('tx_type', group);
    } else {
      query = query.eq('tx_type', type);
    }
  }

  return query;
};

const _buildLatestFetchQuery = ({ supabase, wallet }) => supabase
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

const _isCacheFresh = (fetchedAt) => {
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
    dapp_key: row.dapp_key || null,
    dapp_name: row.dapp_name || null,
    dapp_logo: row.dapp_logo || null,
    dapp_website: row.dapp_website || null,
    dapp_contract: row.dapp_contract || null,
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
    const supabaseKey = String(
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ''
    ).trim();

    if (!wallet || !isValidWalletParam(wallet)) {
      return sendJson(res, 400, { error: 'Missing or invalid wallet query parameter' });
    }

    if (!supabaseUrl) {
      console.error('SUPABASE_URL is not set');
      return sendJson(res, 500, { error: 'Server configuration error' });
    }

    if (!supabaseKey) {
      console.error('SUPABASE_ANON_KEY is not set');
      return sendJson(res, 500, { error: 'Server configuration error' });
    }

    const supabaseResult = createSupabaseAdmin(supabaseUrl, supabaseKey);
    if (!supabaseResult.ok) {
      return sendJson(res, 500, { error: supabaseResult.error });
    }

    const supabase = supabaseResult.supabase;
    const page = requestedPage;

    const eligibilityResult = await isCacheEligibleWallet({ supabase, wallet });
    if (!eligibilityResult.ok) {
      console.error('[transactions] failed to determine cache eligibility', eligibilityResult.error);
      // Fallback to live indexer instead of 500 error
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

    const liveTransactions = await getOrFetchTransactions(wallet, {
      persist: eligibilityResult.eligible,
      allowCachedRead: false,
      limit: TRANSACTION_HISTORY_LIMIT,
    });

    return sendJson(res, 200, formatLiveTransactionsResponse({
      rows: liveTransactions,
      type,
      page,
    }));
  } catch (error) {
    console.error('[transactions] request failed, providing empty response for fallback', error);
    // Return a 200 OK empty response so frontend TrxHistory can fallback to Indexer
    return sendJson(res, 200, {
      transactions: [],
      total: 0,
      page: 1,
      hasMore: false,
      error: 'api_fallback_triggered'
    });
  }
}