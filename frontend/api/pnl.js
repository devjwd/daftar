import { createClient } from '@supabase/supabase-js';

import { handleOptions, methodNotAllowed, sendJson, setApiHeaders } from './_lib/http.js';
import {
  calculatePNL,
  getOrFetchTransactions,
  getTokenPrice,
} from '../src/services/transactionService.js';

const METHODS = ['GET', 'OPTIONS'];
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const ALLOWED_PERIODS = new Set(['today', '7d', '30d', '90d']);

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
    console.error('[pnl] failed to initialize supabase client', error);
    return { ok: false, error: 'Failed to initialize Supabase client' };
  }
};

const normalizeWallet = (wallet) => String(wallet || '').trim().toLowerCase();

const isValidWalletParam = (wallet) => {
  const value = normalizeWallet(wallet);
  return value.startsWith('0x') && value.length > 2;
};

const normalizePeriod = (period) => {
  const value = String(period || '7d').trim().toLowerCase();
  return ALLOWED_PERIODS.has(value) ? value : '7d';
};

const getPeriodStartMs = (period, now = Date.now()) => {
  const current = Number.isFinite(now) ? now : Date.now();

  if (period === 'today') return current - (24 * 60 * 60 * 1000);
  if (period === '7d') return current - (7 * 24 * 60 * 60 * 1000);
  if (period === '30d') return current - (30 * 24 * 60 * 60 * 1000);
  return current - (90 * 24 * 60 * 60 * 1000);
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const filterTransactionsByPeriod = (transactions, period, now = Date.now()) => {
  const startMs = getPeriodStartMs(period, now);

  return (Array.isArray(transactions) ? transactions : []).filter((tx) => {
    const txMs = new Date(tx?.tx_timestamp || tx?.timestamp || 0).getTime();
    return Number.isFinite(txMs) && txMs >= startMs;
  });
};

const buildPeriodScopedFields = (period, pnlValue) => ({
  totalPnl: toNumber(pnlValue),
  todayPnl: period === 'today' ? toNumber(pnlValue) : 0,
  weekPnl: period === '7d' ? toNumber(pnlValue) : 0,
  monthPnl: period === '30d' ? toNumber(pnlValue) : 0,
});

const enrichTransactionsForPnl = async (transactions) => {
  const rows = Array.isArray(transactions) ? transactions : [];
  const enriched = [];

  for (const tx of rows) {
    const nextTx = { ...tx };

    if (String(nextTx?.tx_type || '').toLowerCase() === 'swap') {
      try {
        const priceDate = nextTx.tx_timestamp || nextTx.timestamp || new Date().toISOString();
        const tokenInPrice = nextTx.token_in ? await getTokenPrice(nextTx.token_in, priceDate) : 0;
        const tokenOutPrice = nextTx.token_out ? await getTokenPrice(nextTx.token_out, priceDate) : 0;

        nextTx.amount_in_usd = toNumber(nextTx.amount_in) * tokenInPrice;
        nextTx.amount_out_usd = toNumber(nextTx.amount_out) * tokenOutPrice;
        nextTx.pnl_usd = nextTx.amount_out_usd - nextTx.amount_in_usd;
      } catch (error) {
        console.error('[pnl] failed to enrich swap transaction', error);
        nextTx.amount_in_usd = toNumber(nextTx.amount_in_usd);
        nextTx.amount_out_usd = toNumber(nextTx.amount_out_usd);
        nextTx.pnl_usd = toNumber(nextTx.pnl_usd);
      }
    } else {
      nextTx.amount_in_usd = toNumber(nextTx.amount_in_usd);
      nextTx.amount_out_usd = toNumber(nextTx.amount_out_usd);
      nextTx.pnl_usd = toNumber(nextTx.pnl_usd);
    }

    enriched.push(nextTx);
  }

  return enriched;
};

const buildSnapshotPayload = ({ wallet, period, pnl, txCount, calculatedAt }) => ({
  wallet_address: wallet,
  period,
  realized_pnl: toNumber(pnl.totalPnl),
  total_volume_usd: toNumber(pnl.totalVolume),
  tx_count: txCount,
  best_trade_usd: toNumber(pnl.bestTrade),
  worst_trade_usd: toNumber(pnl.worstTrade),
  pnl_by_day: Array.isArray(pnl.byDay) ? pnl.byDay : [],
  calculated_at: calculatedAt,
});

const buildResponsePayload = ({ wallet, pnl, txCount, cached, calculatedAt }) => ({
  wallet,
  totalPnl: toNumber(pnl.totalPnl),
  todayPnl: toNumber(pnl.todayPnl),
  weekPnl: toNumber(pnl.weekPnl),
  monthPnl: toNumber(pnl.monthPnl),
  byDay: Array.isArray(pnl.byDay) ? pnl.byDay : [],
  bestTrade: toNumber(pnl.bestTrade),
  worstTrade: toNumber(pnl.worstTrade),
  totalVolume: toNumber(pnl.totalVolume),
  txCount,
  cached,
  calculatedAt,
});

const buildResponseFromSnapshot = ({ wallet, snapshot }) => {
  const byDay = Array.isArray(snapshot?.pnl_by_day) ? snapshot.pnl_by_day : [];
  const scopedPnlFields = buildPeriodScopedFields(snapshot?.period, snapshot?.realized_pnl);

  return buildResponsePayload({
    wallet,
    pnl: {
      ...scopedPnlFields,
      byDay,
      bestTrade: snapshot?.best_trade_usd,
      worstTrade: snapshot?.worst_trade_usd,
      totalVolume: snapshot?.total_volume_usd,
    },
    txCount: Number(snapshot?.tx_count || 0),
    cached: true,
    calculatedAt: snapshot?.calculated_at || new Date().toISOString(),
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
    const period = normalizePeriod(req.query.period);
    const now = Date.now();
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

    try {
      const { data: snapshot, error: snapshotError } = await supabase
        .from('pnl_snapshots')
        .select('*')
        .eq('wallet_address', wallet)
        .eq('period', period)
        .maybeSingle();

      if (snapshotError) {
        console.error('[pnl] failed to read cached snapshot', snapshotError);
      } else if (snapshot?.calculated_at) {
        const ageMs = Date.now() - new Date(snapshot.calculated_at).getTime();
        if (ageMs >= 0 && ageMs < SNAPSHOT_TTL_MS) {
          return sendJson(res, 200, buildResponseFromSnapshot({ wallet, snapshot }));
        }
      }
    } catch (error) {
      console.error('[pnl] snapshot lookup failed', error);
    }

    const transactions = await getOrFetchTransactions(wallet);
    const periodTransactions = filterTransactionsByPeriod(transactions, period, now);
    const enrichedTransactions = await enrichTransactionsForPnl(periodTransactions);
    const pnl = calculatePNL(enrichedTransactions);
    const swapTransactions = enrichedTransactions.filter((tx) => String(tx?.tx_type || '').toLowerCase() === 'swap');
    const calculatedAt = new Date().toISOString();
    const txCount = swapTransactions.length;

    const snapshotPayload = buildSnapshotPayload({
      wallet,
      period,
      pnl,
      txCount,
      calculatedAt,
    });

    try {
      const { error: upsertError } = await supabase
        .from('pnl_snapshots')
        .upsert(snapshotPayload, { onConflict: 'wallet_address,period' });

      if (upsertError) {
        console.error('[pnl] failed to upsert snapshot', upsertError);
      }
    } catch (error) {
      console.error('[pnl] snapshot upsert failed', error);
    }

    return sendJson(res, 200, buildResponsePayload({
      wallet,
      pnl,
      txCount,
      cached: false,
      calculatedAt,
    }));
  } catch (error) {
    console.error('[pnl] calculation failed', error);
    return sendJson(res, 500, { error: 'Failed to calculate pnl' });
  }
}