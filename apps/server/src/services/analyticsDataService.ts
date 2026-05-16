/**
 * Analytics Data Aggregation Service
 * 
 * Extracted from index.ts inline route handler.
 * Handles all transaction-based analytics computations:
 * - Volume, gas, inflow/outflow
 * - Protocol usage breakdown
 * - Cumulative activity history
 * - Net flow history
 * - Top entities & tokens
 * - Exchange usage analysis
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  WHITELIST_PROTOCOLS,
  KNOWN_EXCHANGES,
  WHITELIST_TOKENS,
  PROTOCOL_COLORS,
  INFLOW_ACTIONS,
  OUTFLOW_ACTIONS,
  MAX_ANALYTICS_TRANSACTIONS,
  ANALYTICS_PAGE_SIZE,
} from '../config/whitelists.ts';

// --- Types ---

interface TransactionRow {
  user_address: string;
  timestamp: string;
  value_usd: number | string | null;
  gas_usd: number | string | null;
  action: string;
  protocol: string;
  asset_in_symbol: string | null;
  asset_out_symbol: string | null;
}

interface DateValuePoint {
  date: string;
  value: number;
}

interface ProtocolUsageItem {
  name: string;
  value: number;
  color: string;
}

interface EntityItem {
  name: string;
  value: number;
  count: number;
}

interface TokenItem {
  symbol: string;
  value: number;
}

interface ExchangeBreakdownItem {
  name: string;
  value: number;
}

interface ExchangeStats {
  total: number;
  breakdown: ExchangeBreakdownItem[];
  history: DateValuePoint[];
}

interface ExchangeUsage {
  deposits: ExchangeStats;
  withdrawals: ExchangeStats;
}

interface InsightItem {
  type: string;
  title: string;
  desc: string;
  icon: string;
}

export interface AnalyticsDataResult {
  totalVolume: number;
  totalGasUsd: number;
  totalInflow: number;
  totalOutflow: number;
  interactionCount: number;
  cumulativeVolume: number;
  activeMonths: number;
  protocolUsage: ProtocolUsageItem[];
  activityHistory: DateValuePoint[];
  netFlowHistory: DateValuePoint[];
  networthHistory: DateValuePoint[];
  topEntities: EntityItem[];
  topTokens: TokenItem[];
  exchangeUsage: ExchangeUsage;
  insights: InsightItem[];
}

// --- Helpers ---

const isInflowAction = (action: string): boolean =>
  (INFLOW_ACTIONS as readonly string[]).includes(action);

const isOutflowAction = (action: string): boolean =>
  (OUTFLOW_ACTIONS as readonly string[]).includes(action);

function getTimeframeFilterDate(timeframe: string): Date | null {
  if (timeframe === 'All') return null;

  const now = new Date();
  const filterDate = new Date();

  if (timeframe === '1D') filterDate.setHours(now.getHours() - 24);
  else if (timeframe === '1W') filterDate.setDate(now.getDate() - 7);
  else if (timeframe === '1M') filterDate.setMonth(now.getMonth() - 1);
  else if (timeframe === '3M') filterDate.setMonth(now.getMonth() - 3);
  else if (timeframe === '1Y') filterDate.setFullYear(now.getFullYear() - 1);
  else return null;

  return filterDate;
}

// --- Paginated Fetch ---

async function fetchTransactionsPaginated(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string
): Promise<TransactionRow[]> {
  let txs: TransactionRow[] = [];
  let hasMore = true;
  let page = 0;

  while (hasMore && txs.length < MAX_ANALYTICS_TRANSACTIONS) {
    let query = supabase
      .from('user_transaction_history')
      .select('*')
      .eq('user_address', wallet)
      .order('timestamp', { ascending: true })
      .range(page * ANALYTICS_PAGE_SIZE, (page + 1) * ANALYTICS_PAGE_SIZE - 1);

    const filterDate = getTimeframeFilterDate(timeframe);
    if (filterDate) {
      query = query.gte('timestamp', filterDate.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    if (data && data.length > 0) {
      txs = txs.concat(data as TransactionRow[]);
      page++;
      if (data.length < ANALYTICS_PAGE_SIZE) hasMore = false;
    } else {
      hasMore = false;
    }
  }

  return txs;
}

// --- Initial Flow (pre-filter transactions) ---

async function calculateInitialFlow(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string
): Promise<number> {
  if (timeframe === 'All') return 0;

  const filterDate = getTimeframeFilterDate(timeframe);
  if (!filterDate) return 0;

  const { data: pastTxs, error } = await supabase
    .from('user_transaction_history')
    .select('value_usd, action')
    .eq('user_address', wallet)
    .lt('timestamp', filterDate.toISOString());

  if (error || !pastTxs) return 0;

  let initialFlow = 0;
  pastTxs.forEach((tx: { value_usd: number | string | null; action: string }) => {
    const val = Number(tx.value_usd || 0);
    const action = tx.action || '';
    if (isInflowAction(action)) initialFlow += val;
    else if (isOutflowAction(action)) initialFlow -= val;
  });

  return initialFlow;
}

// --- Networth History ---

async function fetchNetworthHistory(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string
): Promise<DateValuePoint[]> {
  let query = supabase
    .from('user_networth_snapshots')
    .select('total_networth_usd, timestamp')
    .eq('user_address', wallet)
    .order('timestamp', { ascending: true });

  const filterDate = getTimeframeFilterDate(timeframe);
  if (filterDate) {
    query = query.gte('timestamp', filterDate.toISOString());
  }

  const { data } = await query.limit(500);

  return (data || []).map((s: { total_networth_usd: number | string; timestamp: string }) => ({
    date: s.timestamp,
    value: Number(s.total_networth_usd),
  }));
}

// --- Main Aggregation ---

export async function aggregateAnalyticsData(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string
): Promise<AnalyticsDataResult> {
  // Fetch transactions and initial flow in parallel
  const [txs, initialFlow, networthHistory] = await Promise.all([
    fetchTransactionsPaginated(supabase, wallet, timeframe),
    calculateInitialFlow(supabase, wallet, timeframe),
    fetchNetworthHistory(supabase, wallet, timeframe),
  ]);

  // --- Basic Aggregates ---
  const totalVolume = txs.reduce((sum, tx) => sum + Number(tx.value_usd || 0), 0);
  const totalGasUsd = txs.reduce((sum, tx) => sum + Number(tx.gas_usd || 0), 0);

  // --- Inflow & Outflow ---
  let totalInflow = 0;
  let totalOutflow = 0;
  txs.forEach(tx => {
    const val = Number(tx.value_usd || 0);
    const action = tx.action || '';
    if (isInflowAction(action)) totalInflow += val;
    else if (isOutflowAction(action)) totalOutflow += val;
  });

  // --- Protocol Usage ---
  const protocols = [...new Set(txs.map(tx => tx.protocol))];
  const protocolUsage: ProtocolUsageItem[] = protocols.map((p, idx) => ({
    name: p,
    value: txs.filter(tx => tx.protocol === p).length,
    color: PROTOCOL_COLORS[idx % PROTOCOL_COLORS.length],
  }));

  // --- Cumulative Volume & Net Flow History ---
  let cumulative = 0;
  let cumulativeFlow = initialFlow;
  const activityByDate = new Map<string, number>();
  const netFlowByDate = new Map<string, number>();

  txs.forEach(tx => {
    cumulative += Number(tx.value_usd || 0);
    const date = tx.timestamp.split('T')[0];
    activityByDate.set(date, cumulative);

    const val = Number(tx.value_usd || 0);
    const action = tx.action || '';
    if (isInflowAction(action)) cumulativeFlow += val;
    else if (isOutflowAction(action)) cumulativeFlow -= val;
    netFlowByDate.set(date, cumulativeFlow);
  });

  const activityHistory = Array.from(activityByDate.entries())
    .map(([date, value]) => ({ date, value }));

  const netFlowHistory = Array.from(netFlowByDate.entries())
    .map(([date, value]) => ({ date, value }));

  if (netFlowHistory.length === 0) {
    netFlowHistory.push({ date: new Date().toISOString().split('T')[0], value: 0 });
  }

  const activeMonths = [...new Set(txs.map(tx => tx.timestamp.substring(0, 7)))].length;

  // --- Top Entities (whitelisted protocols only) ---
  const entityMap = new Map<string, { value: number; count: number }>();
  txs.forEach(tx => {
    if (tx.protocol !== 'Unknown' && WHITELIST_PROTOCOLS.has(tx.protocol)) {
      const entity = tx.protocol;
      const val = Number(tx.value_usd || 0);
      const existing = entityMap.get(entity) || { value: 0, count: 0 };
      entityMap.set(entity, { value: existing.value + val, count: existing.count + 1 });
    }
  });

  const topEntities = Array.from(entityMap.entries())
    .map(([name, stats]) => ({ name, value: stats.value, count: stats.count }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 18);

  // --- Top Tokens (whitelisted symbols only) ---
  const tokenMap = new Map<string, number>();
  txs.forEach(tx => {
    const val = Number(tx.value_usd || 0);
    if (tx.asset_in_symbol && WHITELIST_TOKENS.has(tx.asset_in_symbol)) {
      tokenMap.set(tx.asset_in_symbol, (tokenMap.get(tx.asset_in_symbol) || 0) + val);
    }
    if (tx.asset_out_symbol && tx.asset_out_symbol !== tx.asset_in_symbol && WHITELIST_TOKENS.has(tx.asset_out_symbol)) {
      tokenMap.set(tx.asset_out_symbol, (tokenMap.get(tx.asset_out_symbol) || 0) + val);
    }
  });

  const topTokens = Array.from(tokenMap.entries())
    .map(([symbol, value]) => ({ symbol, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 18);

  // --- Exchange Usage ---
  const exchangeUsage: ExchangeUsage = {
    deposits: { total: 0, breakdown: [], history: [] },
    withdrawals: { total: 0, breakdown: [], history: [] },
  };

  const depMap = new Map<string, number>();
  const witMap = new Map<string, number>();
  let depCumul = 0;
  let witCumul = 0;

  txs.forEach(tx => {
    const val = Number(tx.value_usd || 0);
    const protocol = tx.protocol || 'Unknown';
    const isExchange = KNOWN_EXCHANGES.has(protocol) || protocol.includes('Exchange');

    if (isExchange) {
      const action = tx.action || '';
      const date = tx.timestamp.split('T')[0];

      if (isOutflowAction(action)) {
        exchangeUsage.deposits.total += val;
        depMap.set(protocol, (depMap.get(protocol) || 0) + val);
        depCumul += val;
        exchangeUsage.deposits.history.push({ date, value: depCumul });
      } else if (isInflowAction(action)) {
        exchangeUsage.withdrawals.total += val;
        witMap.set(protocol, (witMap.get(protocol) || 0) + val);
        witCumul += val;
        exchangeUsage.withdrawals.history.push({ date, value: witCumul });
      }
    }
  });

  exchangeUsage.deposits.breakdown = Array.from(depMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  exchangeUsage.withdrawals.breakdown = Array.from(witMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // --- Insights ---
  const insights: InsightItem[] = [
    {
      type: 'achievement',
      title: 'Power User',
      desc: `You have interacted with ${protocols.length} protocols.`,
      icon: '🏆',
    },
    {
      type: 'opportunity',
      title: 'Volume Milestone',
      desc: `Your total volume has reached $${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`,
      icon: '📈',
    },
  ];

  return {
    totalVolume,
    totalGasUsd,
    totalInflow,
    totalOutflow,
    interactionCount: txs.length,
    cumulativeVolume: cumulative,
    activeMonths,
    protocolUsage,
    activityHistory,
    netFlowHistory,
    networthHistory,
    topEntities,
    topTokens,
    exchangeUsage,
    insights,
  };
}
