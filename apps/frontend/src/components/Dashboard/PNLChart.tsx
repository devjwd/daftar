import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Sector } from 'recharts';
import './PNLChart.css';
import { getAssetChange, getPrecisionDecimals } from '../../utils/dashboardUtils';
import PlanGate from '../PlanGate';

const TIME_FRAMES = ['1D', '1W', '1M', '3M', 'All'];
const DEBOUNCE_MS = 200;

const DUMMY_PREMIUM_CHART_DATA = [
  { time: 'Day 1', displayValue: 120 },
  { time: 'Day 2', displayValue: 180 },
  { time: 'Day 3', displayValue: 150 },
  { time: 'Day 4', displayValue: 240 },
  { time: 'Day 5', displayValue: 210 },
  { time: 'Day 6', displayValue: 320 },
  { time: 'Day 7', displayValue: 290 },
  { time: 'Day 8', displayValue: 420 },
];

const SyncingBanner = ({ synced, total }: { synced: number; total: number }) => {
  const pct = total > 0 ? Math.min(100, Math.max(2, (synced / total) * 100)) : 15;
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '10px', padding: '16px', zIndex: 10,
      background: 'rgba(13,13,13,0.8)',
      backdropFilter: 'blur(6px)',
      borderRadius: '8px',
    }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#cda169" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'pnl-spin 1.5s linear infinite' }}>
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
      </svg>
      <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
        Indexing your blockchain history...
      </p>
      {total > 0 && (
        <>
          <div style={{ width: '100%', maxWidth: '160px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #cda169, #e5be8a)', borderRadius: '2px', transition: 'width 0.5s ease' }} />
          </div>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
            {synced.toLocaleString()} / {total.toLocaleString()} transactions
          </span>
        </>
      )}
      <p style={{ margin: 0, fontSize: '10px', color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
        Chart loads automatically when ready
      </p>
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const formattedDate = label === 'Start' || label === 'Now'
      ? label
      : (() => {
        const d = new Date(label);
        return isNaN(d.getTime()) ? '' : d.toLocaleString();
      })();

    const netWorth = payload[0].payload.value ?? 0;
    const sign = netWorth < 0 ? '-' : '';
    const decimals = getPrecisionDecimals(netWorth);
    const formattedNW = `${sign}$${Math.abs(netWorth).toLocaleString(undefined, {
      minimumFractionDigits: decimals < 2 ? decimals : 2,
      maximumFractionDigits: decimals
    })}`;

    return (
      <div className="history-tooltip">
        <div className="tooltip-date">{formattedDate}</div>
        <div className="tooltip-value-row">
          <span className="tooltip-label">Net Worth</span>
          <span className="tooltip-value">{formattedNW}</span>
        </div>
      </div>
    );
  }
  return null;
};

interface PNLChartProps {
  hideValues?: boolean;
  setHideValues?: React.Dispatch<React.SetStateAction<boolean>>;
  handleRefresh?: () => void;
  isRefreshing?: boolean;
  lastRefresh?: number;
  totalValue?: number;
  assetBreakdown?: any[];
  protocolBreakdown?: any[];
  walletAddress?: string | null;
  subscriptionTier?: 'free' | 'lite' | 'pro';
  balances?: any[];
  priceChanges?: Record<string, number>;
  hasProfile?: boolean;
  staticExtraUsd?: number;
  allPositions?: any[];
  liquidityPositions?: any[];
  stakingPositions?: any[];
}

const PNLChart: React.FC<PNLChartProps> = ({
  hideValues = false,
  setHideValues,
  handleRefresh,
  isRefreshing = false,
  lastRefresh = 0,
  totalValue = 0,
  assetBreakdown = [],
  protocolBreakdown = [],
  walletAddress = null,
  subscriptionTier = 'free',
  balances = [],
  priceChanges = {},
  hasProfile = false,
  staticExtraUsd = 0,
  allPositions = [],
  liquidityPositions = [],
  stakingPositions = []
}) => {
  const navigate = useNavigate();
  const isPremium = subscriptionTier !== 'free';
  const [timeframe, setTimeframe] = useState(isPremium ? '1M' : '1D');
  const [activeTab, setActiveTab] = useState('History');
  const [breakdownType, setBreakdownType] = useState('Asset');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartFading, setChartFading] = useState(false);
  // Sync state: set when the API tells us data is actively being indexed
  const [syncingState, setSyncingState] = useState<{ syncing: boolean; synced: number; total: number }>({ syncing: false, synced: 0, total: 0 });

  React.useEffect(() => {
    if (!isPremium) {
      setTimeframe('1D');
    } else {
      setTimeframe('1M');
    }
  }, [isPremium]);

  // Track previous wallet to clear data on wallet switch
  const prevWalletRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  // Debounced timeframe setter to prevent rapid-fire API calls
  const handleTimeframeChange = useCallback((tf: string) => {
    setTimeframe(tf);
  }, []);

  const { combinedBalances, adjustedStaticExtraUsd } = React.useMemo(() => {
    let extraBalances: any[] = [];
    let reducibleUsd = 0;

    // Extract underlying tokens from liquidity positions
    if (liquidityPositions && liquidityPositions.length > 0) {
      liquidityPositions.forEach(pos => {
        if (pos.token0Amount > 0 && pos.underlying) {
          const tokens = pos.underlying.split('/').map((t: string) => t.trim());
          if (tokens[0]) extraBalances.push({ symbol: tokens[0], amount: pos.token0Amount, asset_type: tokens[0] });
          if (tokens[1] && pos.token1Amount > 0) extraBalances.push({ symbol: tokens[1], amount: pos.token1Amount, asset_type: tokens[1] });
          reducibleUsd += (Number(pos.usdValue) || 0);
        } else if (pos.amount > 0 && pos.symbol) {
          extraBalances.push({ symbol: pos.symbol, amount: pos.amount, asset_type: pos.symbol });
          reducibleUsd += (Number(pos.usdValue) || 0);
        }
      });
    }

    // Extract underlying tokens from staking positions
    if (stakingPositions && stakingPositions.length > 0) {
      stakingPositions.forEach(pos => {
        if (pos.amount > 0 && pos.symbol) {
          extraBalances.push({ symbol: pos.symbol, amount: pos.amount, asset_type: pos.symbol });
          reducibleUsd += (Number(pos.usdValue) || 0);
        }
      });
    }

    // Include wallet token balances for per-token repricing.
    const baseBalances = balances && balances.length > 0 ? balances.map((b: any) => ({
      asset_type: b.address,
      symbol: b.symbol,
      amount: b.amount || 0
    })) : [];

    return {
      combinedBalances: [...baseBalances, ...extraBalances],
      adjustedStaticExtraUsd: Math.max(0, staticExtraUsd - reducibleUsd)
    };
  }, [balances, liquidityPositions, stakingPositions, staticExtraUsd]);


  const balancesDep = JSON.stringify(combinedBalances) + '_' + totalValue + '_' + adjustedStaticExtraUsd;

  React.useEffect(() => {
    // Clear stale data immediately when wallet changes
    if (prevWalletRef.current !== walletAddress) {
      prevWalletRef.current = walletAddress;
      setHistoricalData([]);
      setError(null);
    }

    if (!walletAddress || activeTab !== 'History') {
      setHistoricalData([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const currentFetchId = ++fetchIdRef.current;

    // Debounce the fetch to prevent rapid timeframe switches
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Start fade-out immediately for smooth transition
    setChartFading(true);

    debounceTimerRef.current = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fetchOptions: RequestInit = { signal: controller.signal };

        // Pass live balances + the full non-wallet USD (DeFi + LP + staking + NFTs from Dashboard)
        if (combinedBalances.length > 0 || adjustedStaticExtraUsd > 0) {
          fetchOptions.method = 'POST';
          fetchOptions.headers = { 'Content-Type': 'application/json' };
          fetchOptions.body = JSON.stringify({ balances: combinedBalances, staticExtraUsd: adjustedStaticExtraUsd || 0 });
        }

        const API_URL = (import.meta as any).env?.VITE_API_URL || '';
        const res = await fetch(`${API_URL}/api/analytics/pnl-precise?wallet=${walletAddress}&timeframe=${timeframe}`, fetchOptions);
        if (!res.ok) {
          throw new Error('Failed to load history');
        }
        const data = await res.json();

        // Only update if this is still the latest fetch
        if (currentFetchId === fetchIdRef.current && !controller.signal.aborted) {
          // Check if the API indicates a sync is in progress (no data yet)
          if (data?.syncing) {
            setSyncingState({
              syncing: true,
              synced: data.syncProgress?.synced || 0,
              total: data.syncProgress?.total || 0,
            });
            setHistoricalData([]);
          } else {
            setSyncingState({ syncing: false, synced: 0, total: 0 });
            if (data && data.history) {
              const flow = data.history;
              const formattedData = flow.map((pt: any) => ({
                time: pt.date,
                value: pt.value,
                netDeposits: pt.netDeposits || 0
              }));
              setHistoricalData(formattedData);
            } else {
              setHistoricalData([]);
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError' && currentFetchId === fetchIdRef.current) {
          console.error('Failed to fetch PNL history:', err);
          setError(err.message || 'Failed to load history');
        }
      } finally {
        if (currentFetchId === fetchIdRef.current && !controller.signal.aborted) {
          setIsLoading(false);
          setChartFading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [walletAddress, timeframe, activeTab, lastRefresh, isPremium, hasProfile, balancesDep]);

  const formatDonutValue = (val: number): string => {
    if (val === 0) return '$0.00';
    const absVal = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (absVal >= 1.0e9) {
      return `${sign}$${(absVal / 1.0e9).toFixed(2)}B`;
    }
    if (absVal >= 1.0e6) {
      return `${sign}$${(absVal / 1.0e6).toFixed(2)}M`;
    }
    const decimals = getPrecisionDecimals(val);
    return `${sign}$${absVal.toLocaleString(undefined, {
      minimumFractionDigits: decimals < 2 ? decimals : 2,
      maximumFractionDigits: decimals
    })}`;
  };

  const currentBreakdownData = breakdownType === 'Asset' ? assetBreakdown : protocolBreakdown;

  // Map dataToRender (always show Net Worth on the chart line)
  const dataToRender = useMemo(() => {
    if (historicalData.length > 1) {
      const mapped = historicalData.map(pt => ({
        ...pt,
        displayValue: pt.value
      }));
      
      // Append the live net worth to the end of the chart so it perfectly matches the user's current balance
      const lastHistoricalPt = mapped[mapped.length - 1];
      mapped.push({
        time: new Date().toISOString(),
        value: totalValue,
        netDeposits: lastHistoricalPt.netDeposits,
        displayValue: totalValue
      });
      
      return mapped;
    }

    // Return null to signal "no data" so we can show the empty state instead
    return null;
  }, [historicalData, totalValue]);

  // Calculate PnL changes for non-verified users using their current balances and 24h price changes
  const computedChange = useMemo(() => {
    // Use real history data whenever we have it (both pro and free-with-profile users)
    if (dataToRender && dataToRender.length >= 2) {
      const firstVal = dataToRender[0]?.value ?? totalValue;
      const lastVal = dataToRender[dataToRender.length - 1]?.value ?? totalValue;
      const rawChangeUsd = lastVal - firstVal;
      const isPositive = rawChangeUsd >= 0;
      const usdChangeDecimals = getPrecisionDecimals(rawChangeUsd);
      const changeUSD = Math.abs(rawChangeUsd).toLocaleString(undefined, {
        minimumFractionDigits: usdChangeDecimals < 2 ? usdChangeDecimals : 2,
        maximumFractionDigits: usdChangeDecimals
      });

      const baseValue = firstVal > 0 ? firstVal : 0.01;
      let changePercent = '0.00';
      if (baseValue > 0.01) {
        const pct = (rawChangeUsd / baseValue) * 100;
        const absPct = Math.abs(pct);
        const pctDecimals = absPct > 0 && absPct < 0.01 ? 4 : 2;
        changePercent = pct.toFixed(pctDecimals);
      }

      return {
        rawChangeUsd,
        isPositive,
        changeUSD,
        changePercent
      };
    } else {
      // Calculate 24h change from current balances and 24h price changes
      let totalUsdChange = 0;
      let totalPreviousUsd = 0;

      if (balances && priceChanges) {
        balances.forEach((b: any) => {
          const currentUsd = b.usdValue || 0;
          if (currentUsd <= 0) return;

          const changePercent24h = getAssetChange(b.address, b.symbol, priceChanges);
          if (changePercent24h !== undefined && !isNaN(changePercent24h)) {
            const pct = changePercent24h / 100;
            const previousUsd = pct > -0.99 ? currentUsd / (1 + pct) : 0;
            const usdChange = currentUsd - previousUsd;
            totalUsdChange += usdChange;
            totalPreviousUsd += previousUsd;
          } else {
            totalPreviousUsd += currentUsd;
          }
        });
      }

      const isPositive = totalUsdChange >= 0;
      const usdChangeDecimals = getPrecisionDecimals(totalUsdChange);
      const changeUSD = Math.abs(totalUsdChange).toLocaleString(undefined, {
        minimumFractionDigits: usdChangeDecimals < 2 ? usdChangeDecimals : 2,
        maximumFractionDigits: usdChangeDecimals
      });

      let changePercent = '0.00';
      if (totalPreviousUsd > 0) {
        const pct = (totalUsdChange / totalPreviousUsd) * 100;
        const absPct = Math.abs(pct);
        const pctDecimals = absPct > 0 && absPct < 0.01 ? 4 : 2;
        changePercent = pct.toFixed(pctDecimals);
      } else if (totalValue > 0) {
        const previousValue = totalValue - totalUsdChange;
        if (previousValue > 0) {
          const pct = (totalUsdChange / previousValue) * 100;
          const absPct = Math.abs(pct);
          const pctDecimals = absPct > 0 && absPct < 0.01 ? 4 : 2;
          changePercent = pct.toFixed(pctDecimals);
        }
      }

      return {
        rawChangeUsd: totalUsdChange,
        isPositive,
        changeUSD,
        changePercent
      };
    }
  }, [historicalData, dataToRender, totalValue, balances, priceChanges]);

  const { rawChangeUsd, isPositive, changeUSD, changePercent } = computedChange;
  const strokeColor = isPositive ? '#36c690' : '#e06a6a';
  const gradientId = isPositive ? 'colorGreen' : 'colorRed';

  const TIMEFRAME_LABELS: Record<string, string> = {
    '1D': '24H', '1W': '7D', '1M': '30D', '3M': '90D', 'All': 'All'
  };
  const periodLabel = TIMEFRAME_LABELS[timeframe] || timeframe;

  return (
    <div className="pnl-chart-container">
      {/* Tab selector at top */}
      <div className="chart-header-v4">
        <div className="segmented-control">
          <button
            className={`segment-btn ${activeTab === 'History' ? 'active' : ''}`}
            onClick={() => setActiveTab('History')}
            title="History"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </button>
          <button
            className={`segment-btn ${activeTab === 'Breakdown' ? 'active' : ''}`}
            onClick={() => setActiveTab('Breakdown')}
            title="Breakdown"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
          </button>
        </div>

        {activeTab === 'History' && (
          <div className="timeframe-selectors-v4">
            {!isPremium && (
              <div className="pnl-info-icon-wrapper">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <div className="pnl-info-tooltip">
                  For non-Pro users, the 24H PNL is estimated based on your current balances and 24H market price changes.
                  <br /><br />
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>Non-Pro users are limited to only the 24H PNL chart.</span>
                </div>
              </div>
            )}
            {TIME_FRAMES.map((tf) => {
              const isLocked = !isPremium && tf !== '1D';
              return (
                <button
                  key={tf}
                  className={`tf-btn-v4 ${timeframe === tf ? 'active' : ''} ${isLocked ? 'locked' : ''}`}
                  onClick={() => !isLocked && handleTimeframeChange(tf)}
                  disabled={isLocked}
                  title={isLocked ? 'Upgrade to Pro to unlock' : undefined}
                >
                  {isLocked ? (
                    <>
                      {tf}
                      <svg className="tf-lock-icon" width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <path d="M18 11H6V8a6 6 0 0 1 12 0v3zm1 0V8A7 7 0 0 0 5 8v3H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V12a1 1 0 0 0-1-1h-2z"/>
                      </svg>
                    </>
                  ) : tf}
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'Breakdown' && (
          <div className="timeframe-selectors-v4">
            {['Asset', 'Protocol'].map((type) => (
              <button
                key={type}
                className={`tf-btn-v4 ${breakdownType === type ? 'active' : ''}`}
                onClick={() => setBreakdownType(type)}
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* History View */}
      {activeTab === 'History' && (
        <div className="pnl-history-view">
          <div className="pnl-change-badge" data-positive={isPositive}>
            <span className="pnl-change-arrow">{isPositive ? '▲' : '▼'}</span>
            <span className="pnl-change-usd">{isPositive ? '+' : '-'}${changeUSD}</span>
            <span className="pnl-change-percent">({isPositive ? '+' : ''}{changePercent}%)</span>
            <span className="pnl-change-period">{periodLabel}</span>
          </div>
          <div className="pnl-chart-wrapper-v4">
            {!isPremium && timeframe !== '1D' && (
              <div className="pnl-restricted-overlay">
                <div className="restricted-content">
                  <p className="restricted-text">
                    Upgrade to Pro to unlock historical charts beyond the 24h overview.
                  </p>
                </div>
              </div>
            )}

            {isLoading && (
              <div className="pnl-loading-overlay pnl-loading-subtle">
                <div className="chart-loading-shimmer" />
              </div>
            )}
            {/* Syncing state: show when data is being indexed for the first time */}
            {syncingState.syncing && !isLoading && (
              <SyncingBanner synced={syncingState.synced} total={syncingState.total} />
            )}
            {error && (
              <div className="pnl-error-overlay">
                <div className="pnl-error-content">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{error}</span>
                  <button onClick={handleRefresh} className="pnl-retry-btn">Retry</button>
                </div>
              </div>
            )}
            {!isLoading && !error && !syncingState.syncing && dataToRender === null && (
              <div className="pnl-empty-state">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <span className="pnl-empty-title">No chart history yet</span>
                <span className="pnl-empty-sub">Data will appear as your portfolio is indexed</span>
              </div>
            )}
            <div className={`pnl-chart-inner ${chartFading ? 'chart-fading' : ''} ${error ? 'blurred-chart' : ''} ${dataToRender === null ? 'pnl-chart-hidden' : ''}`}>
              <ResponsiveContainer width="99%" height="100%">
                <AreaChart data={dataToRender ?? [{ time: 'Now', value: totalValue, netDeposits: 0, displayValue: totalValue }]} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#36c690" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#36c690" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorRed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e06a6a" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#e06a6a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorGold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#cda169" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#cda169" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'rgba(255, 255, 255, 0.8)', fontSize: 10, fontFamily: 'var(--font-primary)' }}
                    dy={8}
                    minTickGap={40}
                    tickFormatter={(val) => {
                      if (val === 'Start' || val === 'Now') return val;
                      const d = new Date(val);
                      if (isNaN(d.getTime())) return '';
                      if (timeframe === '1D') return d.toLocaleTimeString(undefined, { hour: '2-digit' });
                      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    }}
                  />
                  <YAxis hide={true} domain={['dataMin', 'dataMax']} />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="displayValue"
                    stroke={strokeColor}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill={`url(#${gradientId})`}
                    activeDot={{ r: 4, fill: '#fff', stroke: strokeColor, strokeWidth: 2 }}
                    dot={false}
                    isAnimationActive={true}
                    animationDuration={600}
                    animationEasing="ease-in-out"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Breakdown View */}
      {activeTab === 'Breakdown' && (
        <div className="pnl-breakdown-view">
          <div className="breakdown-donut-area">
            {currentBreakdownData.length === 0 ? (
              <div style={{
                width: 120,
                height: 120,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '6px',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px', textAlign: 'center' }}>No positions to display</span>
              </div>
            ) : (
              <ResponsiveContainer width={120} height={120}>
                <PieChart>
                  <Pie
                    data={currentBreakdownData}
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={56}
                    paddingAngle={3}
                    dataKey="value"
                    startAngle={90}
                    endAngle={-270}
                    strokeWidth={0}
                    isAnimationActive={activeIndex === -1}
                    animationDuration={400}
                    activeShape={(props: any) => {
                      return (
                        <Sector
                          {...props}
                          outerRadius={props.outerRadius + 5}
                          innerRadius={props.innerRadius - 2}
                          fill={props.fill}
                          style={{ transition: 'all 0.15s ease', outline: 'none' }}
                        />
                      );
                    }}
                    activeIndex={activeIndex}
                  >
                    {currentBreakdownData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        opacity={activeIndex === -1 || activeIndex === index ? 0.9 : 0.3}
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseLeave={() => setActiveIndex(-1)}
                        style={{ transition: 'all 0.15s ease', cursor: 'pointer', outline: 'none' }}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="donut-center-label">
              <span className="donut-total-label">
                {activeIndex === -1 ? 'Total' : currentBreakdownData[activeIndex]?.name}
              </span>
              <span className="donut-total-value">
                {activeIndex === -1
                  ? formatDonutValue(totalValue)
                  : formatDonutValue(currentBreakdownData[activeIndex]?.rawValue || 0)
                }
              </span>
            </div>
          </div>

          <div
            className={`breakdown-legend ${activeIndex !== -1 ? 'is-hovering' : ''}`}
            role="tablist"
            aria-label="Portfolio asset breakdown legend"
          >
            {currentBreakdownData.map((item, index) => (
              <div
                className={`breakdown-legend-item ${activeIndex === index ? 'active' : ''}`}
                key={item.name}
                role="tab"
                tabIndex={0}
                aria-selected={activeIndex === index}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(-1)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(-1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveIndex(index);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className="breakdown-legend-left">
                  <span className="breakdown-dot" style={{ background: item.color }} />
                  <span className="breakdown-legend-name">{item.name}</span>
                </div>
                <span className="breakdown-legend-pct">{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PNLChart;
