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
  asset_in_amount: number | string | null;
  asset_out_symbol: string | null;
  asset_out_amount: number | string | null;
}

interface DateValuePoint {
  date: string;
  value: number;
  txCount?: number;
  volume?: number;
  inflow?: number;
  outflow?: number;
  inflowDetails?: Array<{ name: string; value: number }>;
  outflowDetails?: Array<{ name: string; value: number }>;
  holdings?: Array<{ symbol: string; amount: number }>;
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

interface ExchangeHistoryPoint {
  date: string;
  value: number;
  dailyValue: number;
  dailyTokenString: string;
  details: Array<{ name: string; value: number; tokenString: string }>;
}

interface ExchangeStats {
  total: number;
  breakdown: ExchangeBreakdownItem[];
  history: ExchangeHistoryPoint[];
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
  totalBalance?: number;
  tokenBalanceHistory?: DateValuePoint[];
  topEntities: EntityItem[];
  topTokens: TokenItem[];
  exchangeUsage: ExchangeUsage;
  insights: InsightItem[];
  /** True when results were capped at MAX_ANALYTICS_TRANSACTIONS */
  truncated?: boolean;
  loadedTransactionCount?: number;
  maxTransactionLimit?: number;
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

interface PaginatedTxResult {
  txs: TransactionRow[];
  truncated: boolean;
}

async function fetchTransactionsPaginated(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string,
  customStartDate?: string,
  customEndDate?: string
): Promise<PaginatedTxResult> {
  const PAGE_SIZE = ANALYTICS_PAGE_SIZE;

  // Build count query
  let countQuery = supabase
    .from('user_transaction_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', wallet);

  // Build page 0 query
  let page0Query = supabase
    .from('user_transaction_history')
    .select('user_address, timestamp, value_usd, gas_usd, action, protocol, asset_in_symbol, asset_in_amount, asset_out_symbol, asset_out_amount')
    .eq('user_address', wallet)
    .order('timestamp', { ascending: true })
    .range(0, PAGE_SIZE - 1);

  if (customStartDate || customEndDate) {
    const startIso = customStartDate ? new Date(customStartDate).toISOString() : null;
    const endIso = customEndDate ? new Date(customEndDate).toISOString() : null;
    if (startIso) {
      countQuery = countQuery.gte('timestamp', startIso);
      page0Query = page0Query.gte('timestamp', startIso);
    }
    if (endIso) {
      countQuery = countQuery.lte('timestamp', endIso);
      page0Query = page0Query.lte('timestamp', endIso);
    }
  } else {
    const filterDate = getTimeframeFilterDate(timeframe);
    if (filterDate) {
      const filterIso = filterDate.toISOString();
      countQuery = countQuery.gte('timestamp', filterIso);
      page0Query = page0Query.gte('timestamp', filterIso);
    }
  }

  // Round Trip 1: Fetch count and Page 0 in parallel
  const [countRes, page0Res] = await Promise.all([countQuery, page0Query]);
  if (countRes.error) throw countRes.error;
  if (page0Res.error) throw page0Res.error;

  const count = countRes.count || 0;
  let txs: TransactionRow[] = (page0Res.data || []) as TransactionRow[];

  // Round Trip 2: Fetch remaining pages in parallel if needed
  if (count > PAGE_SIZE) {
    const remainingLimit = Math.min(count, MAX_ANALYTICS_TRANSACTIONS);
    const numPages = Math.ceil(remainingLimit / PAGE_SIZE);
    const pagePromises = [];

    for (let page = 1; page < numPages; page++) {
      let query = supabase
        .from('user_transaction_history')
        .select('user_address, timestamp, value_usd, gas_usd, action, protocol, asset_in_symbol, asset_in_amount, asset_out_symbol, asset_out_amount')
        .eq('user_address', wallet)
        .order('timestamp', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (customStartDate || customEndDate) {
        const startIso = customStartDate ? new Date(customStartDate).toISOString() : null;
        const endIso = customEndDate ? new Date(customEndDate).toISOString() : null;
        if (startIso) query = query.gte('timestamp', startIso);
        if (endIso) query = query.lte('timestamp', endIso);
      } else {
        const filterDate = getTimeframeFilterDate(timeframe);
        if (filterDate) query = query.gte('timestamp', filterDate.toISOString());
      }
      pagePromises.push(query);
    }

    const results = await Promise.all(pagePromises);
    for (const res of results) {
      if (res.error) throw res.error;
      if (res.data) {
        txs = txs.concat(res.data as TransactionRow[]);
      }
    }
  }

  const truncated = count > MAX_ANALYTICS_TRANSACTIONS;
  return { txs, truncated };
}

// --- Initial Flow (pre-filter transactions) ---

async function calculateInitialFlow(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string,
  customStartDate?: string
): Promise<number> {
  let filterDate: Date | null = null;
  if (customStartDate) {
    filterDate = new Date(customStartDate);
  } else {
    if (timeframe === 'All') return 0;
    filterDate = getTimeframeFilterDate(timeframe);
  }

  if (!filterDate) return 0;

  const { data: snapshot, error } = await supabase
    .from('user_networth_snapshots')
    .select('net_deposits_usd')
    .eq('user_address', wallet)
    .lt('timestamp', filterDate.toISOString())
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !snapshot) return 0;
  return Number(snapshot.net_deposits_usd || 0);
}

// --- Networth History ---

async function fetchNetworthHistory(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string,
  customStartDate?: string,
  customEndDate?: string
): Promise<DateValuePoint[]> {
  const MAX_NETWORTH_SNAPSHOTS = 5000;
  const PAGE_SIZE = 1000;

  let countQuery = supabase
    .from('user_networth_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', wallet);

  let page0Query = supabase
    .from('user_networth_snapshots')
    .select('total_networth_usd, timestamp')
    .eq('user_address', wallet)
    .order('timestamp', { ascending: true })
    .range(0, PAGE_SIZE - 1);

  if (customStartDate || customEndDate) {
    const startIso = customStartDate ? new Date(customStartDate).toISOString() : null;
    const endIso = customEndDate ? new Date(customEndDate).toISOString() : null;
    if (startIso) {
      countQuery = countQuery.gte('timestamp', startIso);
      page0Query = page0Query.gte('timestamp', startIso);
    }
    if (endIso) {
      countQuery = countQuery.lte('timestamp', endIso);
      page0Query = page0Query.lte('timestamp', endIso);
    }
  } else {
    const filterDate = getTimeframeFilterDate(timeframe);
    if (filterDate) {
      const filterIso = filterDate.toISOString();
      countQuery = countQuery.gte('timestamp', filterIso);
      page0Query = page0Query.gte('timestamp', filterIso);
    }
  }

  // Round Trip 1
  const [countRes, page0Res] = await Promise.all([countQuery, page0Query]);
  if (countRes.error) throw countRes.error;
  if (page0Res.error) throw page0Res.error;

  const count = countRes.count || 0;
  let snaps = page0Res.data || [];

  // Round Trip 2
  if (count > PAGE_SIZE) {
    const remainingLimit = Math.min(count, MAX_NETWORTH_SNAPSHOTS);
    const numPages = Math.ceil(remainingLimit / PAGE_SIZE);
    const pagePromises = [];

    for (let page = 1; page < numPages; page++) {
      let query = supabase
        .from('user_networth_snapshots')
        .select('total_networth_usd, timestamp')
        .eq('user_address', wallet)
        .order('timestamp', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (customStartDate || customEndDate) {
        const startIso = customStartDate ? new Date(customStartDate).toISOString() : null;
        const endIso = customEndDate ? new Date(customEndDate).toISOString() : null;
        if (startIso) query = query.gte('timestamp', startIso);
        if (endIso) query = query.lte('timestamp', endIso);
      } else {
        const filterDate = getTimeframeFilterDate(timeframe);
        if (filterDate) query = query.gte('timestamp', filterDate.toISOString());
      }
      pagePromises.push(query);
    }

    const results = await Promise.all(pagePromises);
    for (const res of results) {
      if (res.error) throw res.error;
      if (res.data) {
        snaps = snaps.concat(res.data);
      }
    }
  }

  return snaps.map((s: { total_networth_usd: number | string; timestamp: string }) => ({
    date: s.timestamp,
    value: Number(s.total_networth_usd),
  }));
}

// --- Token Balance History ---

async function fetchTokenBalanceHistory(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string,
  customStartDate?: string,
  customEndDate?: string
): Promise<DateValuePoint[]> {
  const MAX_NETWORTH_SNAPSHOTS = 5000;
  const MAX_BAL_SNAPSHOTS = 10000;
  const PAGE_SIZE = 1000;

  // 1. Build Networth queries
  let nwCountQuery = supabase
    .from('user_networth_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', wallet);

  let nwPage0Query = supabase
    .from('user_networth_snapshots')
    .select('wallet_usd, timestamp')
    .eq('user_address', wallet)
    .order('timestamp', { ascending: true })
    .range(0, PAGE_SIZE - 1);

  // 2. Build Balance queries
  let balCountQuery = supabase
    .from('user_balance_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', wallet);

  let balPage0Query = supabase
    .from('user_balance_snapshots')
    .select('snapshot_date, symbol, amount')
    .eq('user_address', wallet)
    .order('snapshot_date', { ascending: true })
    .range(0, PAGE_SIZE - 1);

  if (customStartDate || customEndDate) {
    const startIso = customStartDate ? new Date(customStartDate).toISOString() : null;
    const endIso = customEndDate ? new Date(customEndDate).toISOString() : null;
    const startDay = customStartDate ? customStartDate.split('T')[0] : null;
    const endDay = customEndDate ? customEndDate.split('T')[0] : null;

    if (startIso) {
      nwCountQuery = nwCountQuery.gte('timestamp', startIso);
      nwPage0Query = nwPage0Query.gte('timestamp', startIso);
    }
    if (endIso) {
      nwCountQuery = nwCountQuery.lte('timestamp', endIso);
      nwPage0Query = nwPage0Query.lte('timestamp', endIso);
    }
    if (startDay) {
      balCountQuery = balCountQuery.gte('snapshot_date', startDay);
      balPage0Query = balPage0Query.gte('snapshot_date', startDay);
    }
    if (endDay) {
      balCountQuery = balCountQuery.lte('snapshot_date', endDay);
      balPage0Query = balPage0Query.lte('snapshot_date', endDay);
    }
  } else {
    const filterDate = getTimeframeFilterDate(timeframe);
    if (filterDate) {
      const filterIso = filterDate.toISOString();
      const filterDay = filterIso.split('T')[0];

      nwCountQuery = nwCountQuery.gte('timestamp', filterIso);
      nwPage0Query = nwPage0Query.gte('timestamp', filterIso);

      balCountQuery = balCountQuery.gte('snapshot_date', filterDay);
      balPage0Query = balPage0Query.gte('snapshot_date', filterDay);
    }
  }

  // Round Trip 1: Fetch NW count/page0 AND BAL count/page0 in parallel
  const [nwCountRes, nwPage0Res, balCountRes, balPage0Res] = await Promise.all([
    nwCountQuery,
    nwPage0Query,
    balCountQuery,
    balPage0Query
  ]);

  if (nwCountRes.error) throw nwCountRes.error;
  if (nwPage0Res.error) throw nwPage0Res.error;
  if (balCountRes.error) throw balCountRes.error;
  if (balPage0Res.error) throw balPage0Res.error;

  const nwCount = nwCountRes.count || 0;
  let nwData = nwPage0Res.data || [];
  const balCount = balCountRes.count || 0;
  let balData = balPage0Res.data || [];

  // Round Trip 2: Fetch remaining pages for BOTH in parallel if needed
  const promises2 = [];

  const needsMoreNW = nwCount > PAGE_SIZE;
  const needsMoreBal = balCount > PAGE_SIZE;

  let nwPromisesStartIndex = -1;
  let balPromisesStartIndex = -1;

  if (needsMoreNW) {
    nwPromisesStartIndex = promises2.length;
    const remainingLimit = Math.min(nwCount, MAX_NETWORTH_SNAPSHOTS);
    const numPages = Math.ceil(remainingLimit / PAGE_SIZE);
    for (let page = 1; page < numPages; page++) {
      let query = supabase
        .from('user_networth_snapshots')
        .select('wallet_usd, timestamp')
        .eq('user_address', wallet)
        .order('timestamp', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (customStartDate || customEndDate) {
        const startIso = customStartDate ? new Date(customStartDate).toISOString() : null;
        const endIso = customEndDate ? new Date(customEndDate).toISOString() : null;
        if (startIso) query = query.gte('timestamp', startIso);
        if (endIso) query = query.lte('timestamp', endIso);
      } else {
        const filterDate = getTimeframeFilterDate(timeframe);
        if (filterDate) query = query.gte('timestamp', filterDate.toISOString());
      }
      promises2.push(query);
    }
  }

  if (needsMoreBal) {
    balPromisesStartIndex = promises2.length;
    const remainingLimit = Math.min(balCount, MAX_BAL_SNAPSHOTS);
    const numPages = Math.ceil(remainingLimit / PAGE_SIZE);
    for (let page = 1; page < numPages; page++) {
      let query = supabase
        .from('user_balance_snapshots')
        .select('snapshot_date, symbol, amount')
        .eq('user_address', wallet)
        .order('snapshot_date', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (customStartDate || customEndDate) {
        const startDay = customStartDate ? customStartDate.split('T')[0] : null;
        const endDay = customEndDate ? customEndDate.split('T')[0] : null;
        if (startDay) query = query.gte('snapshot_date', startDay);
        if (endDay) query = query.lte('snapshot_date', endDay);
      } else {
        const filterDate = getTimeframeFilterDate(timeframe);
        if (filterDate) query = query.gte('snapshot_date', filterDate.toISOString().split('T')[0]);
      }
      promises2.push(query);
    }
  }

  if (promises2.length > 0) {
    const results2 = await Promise.all(promises2);
    
    if (needsMoreNW) {
      const numNwPromises = Math.ceil(Math.min(nwCount, MAX_NETWORTH_SNAPSHOTS) / PAGE_SIZE) - 1;
      for (let i = 0; i < numNwPromises; i++) {
        const res = results2[nwPromisesStartIndex + i];
        if (res.error) throw res.error;
        if (res.data) nwData = nwData.concat(res.data as any);
      }
    }

    if (needsMoreBal) {
      const numBalPromises = Math.ceil(Math.min(balCount, MAX_BAL_SNAPSHOTS) / PAGE_SIZE) - 1;
      for (let i = 0; i < numBalPromises; i++) {
        const res = results2[balPromisesStartIndex + i];
        if (res.error) throw res.error;
        if (res.data) balData = balData.concat(res.data as any);
      }
    }
  }

  // Map to daily balance (taking the last one per day since timestamp contains hours)
  const dailyBalanceMap = new Map<string, number>();
  if (nwData) {
    nwData.forEach((s: any) => {
      const dateKey = s.timestamp.split('T')[0];
      dailyBalanceMap.set(dateKey, Number(s.wallet_usd || 0));
    });
  }

  // Group holdings by date
  const holdingsMap = new Map<string, Array<{ symbol: string; amount: number }>>();
  if (balData) {
    balData.forEach((b: any) => {
      const dateKey = b.snapshot_date;
      if (!holdingsMap.has(dateKey)) {
        holdingsMap.set(dateKey, []);
      }
      holdingsMap.get(dateKey)!.push({
        symbol: b.symbol || 'Unknown',
        amount: Number(b.amount || 0)
      });
    });
  }

  // Combine dates from both maps
  const allDates = Array.from(new Set([
    ...Array.from(dailyBalanceMap.keys()),
    ...Array.from(holdingsMap.keys())
  ])).sort();

  const tokenBalanceHistory = allDates.map(date => ({
    date,
    value: dailyBalanceMap.get(date) ?? 0,
    holdings: holdingsMap.get(date) ?? []
  }));

  const earliestDataDate =
    allDates.length > 0 ? allDates[0] : null;
  const baselineDateStr = customStartDate
    ? customStartDate.split('T')[0]
    : timeframe === 'All'
      ? earliestDataDate
      : null;
  if (baselineDateStr) {
    if (tokenBalanceHistory.length === 0 || tokenBalanceHistory[0].date > baselineDateStr) {
      tokenBalanceHistory.unshift({
        date: baselineDateStr,
        value: 0,
        holdings: []
      });
    }
  }

  return tokenBalanceHistory;
}

// --- Main Aggregation ---

export async function aggregateAnalyticsData(
  supabase: SupabaseClient,
  wallet: string,
  timeframe: string,
  customStartDate?: string,
  customEndDate?: string
): Promise<AnalyticsDataResult> {
  const [txResult, initialFlow, networthHistory, tokenBalanceHistory] = await Promise.all([
    fetchTransactionsPaginated(supabase, wallet, timeframe, customStartDate, customEndDate),
    calculateInitialFlow(supabase, wallet, timeframe, customStartDate),
    fetchNetworthHistory(supabase, wallet, timeframe, customStartDate, customEndDate),
    fetchTokenBalanceHistory(supabase, wallet, timeframe, customStartDate, customEndDate),
  ]);

  const txs = txResult.txs;
  const truncated = txResult.truncated;

  // --- Basic Aggregates ---
  const totalVolume = txs.reduce((sum, tx) => sum + Number(tx.value_usd || 0), 0);
  const totalGasUsd = txs.reduce((sum, tx) => sum + Number(tx.gas_usd || 0), 0);

  // --- Inflow & Outflow (All funds received and sent/withdrawn) ---
  let totalInflow = 0;
  let totalOutflow = 0;
  txs.forEach(tx => {
    const val = Number(tx.value_usd || 0);
    const action = tx.action || '';

    if (isInflowAction(action)) {
      totalInflow += val;
    } else if (isOutflowAction(action)) {
      totalOutflow += val;
    }
  });

  // --- Protocol Usage (Sorted by usage frequency descending) ---
  const protocols = [...new Set(txs.map(tx => tx.protocol))];
  const protocolUsage: ProtocolUsageItem[] = protocols
    .map(p => ({
      name: p,
      value: txs.filter(tx => tx.protocol === p).length,
    }))
    .sort((a, b) => b.value - a.value)
    .map((item, idx) => ({
      ...item,
      color: PROTOCOL_COLORS[idx % PROTOCOL_COLORS.length],
    }));

  // --- Cumulative Volume, Flow, & Daily Stats History ---
  let cumulative = 0;
  let cumulativeFlow = initialFlow;
  
  const dailyStats = new Map<string, { 
    volume: number; 
    inflow: number; 
    outflow: number; 
    txCount: number;
    inflowDetails: Map<string, number>;
    outflowDetails: Map<string, number>;
  }>();
  const netFlowByDate = new Map<string, number>();

  txs.forEach(tx => {
    const val = Number(tx.value_usd || 0);
    const action = tx.action || '';
    const date = tx.timestamp.split('T')[0];
    const protocol = tx.protocol || 'Unknown';

    const stats = dailyStats.get(date) || { 
      volume: 0, 
      inflow: 0, 
      outflow: 0, 
      txCount: 0,
      inflowDetails: new Map<string, number>(),
      outflowDetails: new Map<string, number>()
    };
    stats.txCount += 1;
    stats.volume += val;

    if (isInflowAction(action)) {
      stats.inflow += val;
      stats.inflowDetails.set(protocol, (stats.inflowDetails.get(protocol) || 0) + val);
    } else if (isOutflowAction(action)) {
      stats.outflow += val;
      stats.outflowDetails.set(protocol, (stats.outflowDetails.get(protocol) || 0) + val);
    }
    dailyStats.set(date, stats);

    const isExchange = KNOWN_EXCHANGES.has(protocol) || protocol.includes('Exchange') || protocol.includes('Bridge');
    if (isExchange) {
      if (isInflowAction(action)) {
        cumulativeFlow += val;
      } else if (isOutflowAction(action)) {
        cumulativeFlow -= val;
      }
    }
    netFlowByDate.set(date, cumulativeFlow);
  });

  const sortedDates = Array.from(dailyStats.keys()).sort();
  const activityHistory = sortedDates.map(date => {
    const stats = dailyStats.get(date)!;
    cumulative += stats.volume;
    return {
      date,
      value: cumulative,
      volume: stats.volume,
      inflow: stats.inflow,
      outflow: stats.outflow,
      txCount: stats.txCount,
      inflowDetails: Array.from(stats.inflowDetails.entries()).map(([name, value]) => ({ name, value })),
      outflowDetails: Array.from(stats.outflowDetails.entries()).map(([name, value]) => ({ name, value }))
    };
  });

  const netFlowHistory = Array.from(netFlowByDate.entries())
    .map(([date, value]) => ({ date, value }));

  if (netFlowHistory.length === 0) {
    netFlowHistory.push({ date: new Date().toISOString().split('T')[0], value: 0 });
  }

  const activeMonths = [...new Set(txs.map(tx => tx.timestamp.substring(0, 7)))].length;

  // --- Top Entities (all protocols/dapps except Unknown and exchanges/bridges) ---
  const entityMap = new Map<string, { value: number; count: number }>();
  txs.forEach(tx => {
    const protocol = tx.protocol || 'Unknown';
    const isExchangeOrBridge = KNOWN_EXCHANGES.has(protocol) || 
                               protocol.toLowerCase().includes('exchange') || 
                               protocol.toLowerCase().includes('bridge');
    if (protocol !== 'Unknown' && !isExchangeOrBridge) {
      const entity = protocol;
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
  const depHistoryMap = new Map<string, number>();
  const witHistoryMap = new Map<string, number>();

  const formatTokenDetails = (tokens: Map<string, number>): string => {
    return Array.from(tokens.entries())
      .map(([symbol, amount]) => {
        const formattedAmt = amount.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 4
        });
        return `${formattedAmt} ${symbol}`;
      })
      .join(', ');
  };

  const depDailyStats = new Map<string, { 
    value: number; 
    details: Map<string, { value: number; tokens: Map<string, number> }>;
    tokens: Map<string, number>;
  }>();
  const witDailyStats = new Map<string, { 
    value: number; 
    details: Map<string, { value: number; tokens: Map<string, number> }>;
    tokens: Map<string, number>;
  }>();

  txs.forEach(tx => {
    const val = Number(tx.value_usd || 0);
    const protocol = tx.protocol || 'Unknown';
    const isExchange = KNOWN_EXCHANGES.has(protocol) || protocol.includes('Exchange') || protocol.includes('Bridge');

    if (isExchange) {
      const action = tx.action || '';
      const date = tx.timestamp.split('T')[0];

      // Exchange Deposit = user sends tokens TO exchange (outflow from wallet)
      // Exchange Withdrawal = user receives tokens FROM exchange (inflow to wallet)
      if (isOutflowAction(action)) {
        exchangeUsage.deposits.total += val;
        depMap.set(protocol, (depMap.get(protocol) || 0) + val);
        depCumul += val;
        depHistoryMap.set(date, depCumul);

        const daily = depDailyStats.get(date) || { 
          value: 0, 
          details: new Map<string, { value: number; tokens: Map<string, number> }>(),
          tokens: new Map<string, number>()
        };
        daily.value += val;

        const protoDetail = daily.details.get(protocol) || { value: 0, tokens: new Map<string, number>() };
        protoDetail.value += val;

        const tokenSym = tx.asset_out_symbol || 'Unknown';
        const tokenAmt = Number(tx.asset_out_amount || 0);
        if (tokenAmt > 0) {
          protoDetail.tokens.set(tokenSym, (protoDetail.tokens.get(tokenSym) || 0) + tokenAmt);
          daily.tokens.set(tokenSym, (daily.tokens.get(tokenSym) || 0) + tokenAmt);
        }

        daily.details.set(protocol, protoDetail);
        depDailyStats.set(date, daily);
      } else if (isInflowAction(action)) {
        exchangeUsage.withdrawals.total += val;
        witMap.set(protocol, (witMap.get(protocol) || 0) + val);
        witCumul += val;
        witHistoryMap.set(date, witCumul);

        const daily = witDailyStats.get(date) || { 
          value: 0, 
          details: new Map<string, { value: number; tokens: Map<string, number> }>(),
          tokens: new Map<string, number>()
        };
        daily.value += val;

        const protoDetail = daily.details.get(protocol) || { value: 0, tokens: new Map<string, number>() };
        protoDetail.value += val;

        const tokenSym = tx.asset_in_symbol || 'Unknown';
        const tokenAmt = Number(tx.asset_in_amount || 0);
        if (tokenAmt > 0) {
          protoDetail.tokens.set(tokenSym, (protoDetail.tokens.get(tokenSym) || 0) + tokenAmt);
          daily.tokens.set(tokenSym, (daily.tokens.get(tokenSym) || 0) + tokenAmt);
        }

        daily.details.set(protocol, protoDetail);
        witDailyStats.set(date, daily);
      }
    }
  });

  exchangeUsage.deposits.history = Array.from(depHistoryMap.entries()).map(([date, value]) => {
    const daily = depDailyStats.get(date) || { 
      value: 0, 
      details: new Map<string, { value: number; tokens: Map<string, number> }>(),
      tokens: new Map<string, number>()
    };
    return {
      date,
      value,
      dailyValue: daily.value,
      dailyTokenString: formatTokenDetails(daily.tokens),
      details: Array.from(daily.details.entries()).map(([name, detail]) => ({
        name,
        value: detail.value,
        tokenString: formatTokenDetails(detail.tokens)
      }))
    };
  });

  exchangeUsage.withdrawals.history = Array.from(witHistoryMap.entries()).map(([date, value]) => {
    const daily = witDailyStats.get(date) || { 
      value: 0, 
      details: new Map<string, { value: number; tokens: Map<string, number> }>(),
      tokens: new Map<string, number>()
    };
    return {
      date,
      value,
      dailyValue: daily.value,
      dailyTokenString: formatTokenDetails(daily.tokens),
      details: Array.from(daily.details.entries()).map(([name, detail]) => ({
        name,
        value: detail.value,
        tokenString: formatTokenDetails(detail.tokens)
      }))
    };
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

  const firstTxDateStr =
    txs.length > 0 ? txs[0].timestamp.split('T')[0] : null;
  const baselineDateStr = customStartDate
    ? customStartDate.split('T')[0]
    : timeframe === 'All'
      ? firstTxDateStr
      : null;
  if (baselineDateStr) {
    if (activityHistory.length === 0 || activityHistory[0].date > baselineDateStr) {
      activityHistory.unshift({
        date: baselineDateStr,
        value: 0,
        volume: 0,
        inflow: 0,
        outflow: 0,
        txCount: 0,
        inflowDetails: [],
        outflowDetails: []
      });
    }

    exchangeUsage.deposits.history.sort((a, b) => a.date.localeCompare(b.date));
    if (exchangeUsage.deposits.history.length === 0 || exchangeUsage.deposits.history[0].date > baselineDateStr) {
      exchangeUsage.deposits.history.unshift({
        date: baselineDateStr,
        value: 0,
        dailyValue: 0,
        dailyTokenString: '',
        details: []
      });
    }

    exchangeUsage.withdrawals.history.sort((a, b) => a.date.localeCompare(b.date));
    if (exchangeUsage.withdrawals.history.length === 0 || exchangeUsage.withdrawals.history[0].date > baselineDateStr) {
      exchangeUsage.withdrawals.history.unshift({
        date: baselineDateStr,
        value: 0,
        dailyValue: 0,
        dailyTokenString: '',
        details: []
      });
    }
  }

  const totalBalance = tokenBalanceHistory.length > 0 ? tokenBalanceHistory[tokenBalanceHistory.length - 1].value : 0;

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
    totalBalance,
    tokenBalanceHistory,
    topEntities,
    topTokens,
    exchangeUsage,
    insights,
    truncated,
    loadedTransactionCount: txs.length,
    maxTransactionLimit: MAX_ANALYTICS_TRANSACTIONS,
  };
}
