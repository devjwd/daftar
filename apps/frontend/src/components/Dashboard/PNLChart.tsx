import React, { useState, useMemo, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Sector } from 'recharts';
import './PNLChart.css';

const TIME_FRAMES = ['1D', '1W', '1M', '3M', 'All'];
const DEBOUNCE_MS = 200;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const formattedDate = label === 'Start' || label === 'Now' 
      ? label 
      : (() => {
          const d = new Date(label);
          return isNaN(d.getTime()) ? '' : d.toLocaleString();
        })();

    const netWorth = payload[0].payload.value ?? 0;

    const nwSign = netWorth < 0 ? '-' : '';
    const formattedNW = `${nwSign}$${Math.abs(netWorth).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    return (
      <div className="history-tooltip" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
  isVerified?: boolean;
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
  isVerified = false
}) => {
  const [timeframe, setTimeframe] = useState('1M');
  const [activeTab, setActiveTab] = useState('History');
  const [breakdownType, setBreakdownType] = useState('Asset');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartFading, setChartFading] = useState(false);

  // Track previous wallet to clear data on wallet switch
  const prevWalletRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  // Debounced timeframe setter to prevent rapid-fire API calls
  const handleTimeframeChange = useCallback((tf: string) => {
    setTimeframe(tf);
  }, []);

  React.useEffect(() => {
    // Clear stale data immediately when wallet changes
    if (prevWalletRef.current !== walletAddress) {
      prevWalletRef.current = walletAddress;
      setHistoricalData([]);
      setError(null);
    }

    if (!walletAddress || activeTab !== 'History' || !isVerified) {
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
        const API_URL = (import.meta as any).env?.VITE_API_URL || '';
        const res = await fetch(`${API_URL}/api/analytics/pnl-precise?wallet=${walletAddress}&timeframe=${timeframe}`, {
          signal: controller.signal
        });
        if (!res.ok) {
          throw new Error("Failed to load history");
        }
        const data = await res.json();
        
        // Only update if this is still the latest fetch
        if (currentFetchId === fetchIdRef.current && !controller.signal.aborted) {
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
      } catch (err: any) {
        if (err.name !== 'AbortError' && currentFetchId === fetchIdRef.current) {
          console.error("Failed to fetch PNL history:", err);
          setError(err.message || "Failed to load history");
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
  }, [walletAddress, timeframe, activeTab, lastRefresh, isVerified]);

  // Compact number formatter for donut center value to prevent text spill
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
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  const currentBreakdownData = breakdownType === 'Asset' ? assetBreakdown : protocolBreakdown;

  // Map dataToRender (always show Net Worth on the chart line)
  const dataToRender = useMemo(() => {
    const rawData = historicalData.length > 1 
      ? historicalData 
      : [{ time: 'Start', value: totalValue, netDeposits: 0 }, { time: 'Now', value: totalValue, netDeposits: 0 }];

    return rawData.map(pt => ({
      ...pt,
      displayValue: pt.value
    }));
  }, [historicalData, totalValue]);

  const firstVal = dataToRender[0]?.value ?? totalValue;
  const lastVal = dataToRender[dataToRender.length - 1]?.value ?? totalValue;
  
  // Calculate Net Worth change
  const rawChangeUsd = lastVal - firstVal;
  const isPositive = rawChangeUsd >= 0;
  const changeUSD = Math.abs(rawChangeUsd).toFixed(2);
  
  // Base value for percentage change calculations
  const baseValue = firstVal > 0 ? firstVal : 0.01;
  const changePercent = baseValue > 0.01 ? ((rawChangeUsd / baseValue) * 100).toFixed(2) : '0.00';
  const strokeColor = isPositive ? '#36c690' : '#e06a6a';
  const gradientId = isPositive ? 'colorGreen' : 'colorRed';

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
            {TIME_FRAMES.map((tf) => (
              <button
                key={tf}
                className={`tf-btn-v4 ${timeframe === tf ? 'active' : ''}`}
                onClick={() => handleTimeframeChange(tf)}
                disabled={!isVerified}
              >
                {tf}
              </button>
            ))}
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
          </div>
          <div className="pnl-chart-wrapper-v4">
            {!isVerified ? (
              <div className="pnl-unverified-state" style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: '10px',
                padding: '24px',
                textAlign: 'center',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13px', lineHeight: 1.5, margin: 0 }}>
                  Historical Net Worth is available for verified profiles.
                </p>
                <a
                  href="https://daftar.fi/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--primary)', fontSize: '12px', textDecoration: 'none', opacity: 0.8 }}
                  title="Verification means your transaction history has been fully indexed and you have a Daftar profile."
                >
                  What is verification? ↗
                </a>
              </div>
            ) : (
              <>
                {isLoading && (
                  <div className="pnl-loading-overlay pnl-loading-subtle">
                    <div className="chart-loading-shimmer" />
                  </div>
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
                <div className={`pnl-chart-inner ${chartFading ? 'chart-fading' : ''} ${error ? 'blurred-chart' : ''}`}>
                  <ResponsiveContainer width="99%" height="100%">
                    <AreaChart data={dataToRender} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorGreen" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#36c690" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#36c690" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorRed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#e06a6a" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#e06a6a" stopOpacity={0} />
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
                      <YAxis hide={true} domain={[(min: number) => min - Math.abs(min) * 0.1 - 1, (max: number) => max + Math.abs(max) * 0.1 + 1]} />
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
              </>
            )}
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
