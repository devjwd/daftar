export interface ExchangeBreakdownItem {
  name: string;
  value: number;
}

export interface ExchangeHistoryItem {
  date: string;
  value: number;
  dailyValue?: number;
  details?: Array<{ name: string; value: number }>;
}

export interface ExchangeStats {
  total: number;
  breakdown: ExchangeBreakdownItem[];
  history: ExchangeHistoryItem[];
}

export interface AnalyticsData {
  totalVolume: number;
  totalGasUsd: number;
  totalInflow: number;
  totalOutflow: number;
  interactionCount: number;
  cumulativeVolume: number;
  activeMonths: number;
  activityHistory: Array<{
    date: string;
    value: number;
    txCount?: number;
    volume?: number;
    inflow?: number;
    outflow?: number;
    inflowDetails?: Array<{ name: string; value: number }>;
    outflowDetails?: Array<{ name: string; value: number }>;
  }>;
  netFlowHistory: Array<{ date: string; value: number }>;
  networthHistory?: Array<{ date: string; value: number }>;
  protocolUsage: Array<{ name: string; value: number; color: string }>;
  topEntities: Array<{ name: string; value: number; count?: number }>;
  topTokens: Array<{ symbol: string; value: number }>;
  exchangeUsage: {
    deposits: ExchangeStats;
    withdrawals: ExchangeStats;
  };
  insights: Array<{ type: string; title: string; desc: string; icon: string }>;
}
