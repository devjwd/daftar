import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Sector } from 'recharts';
import './PNLChart.css';

const TIME_FRAMES = ['1D', '1W', '1M', '3M', 'All'];

const generateMockData = (timeframe: string) => {
  const data = [];
  let points = 24;
  let baseValue = 100;
  let volatility = 5;

  if (timeframe === '1D') { points = 24; volatility = 8; baseValue = 95; }
  else if (timeframe === '1W') { points = 7; volatility = 15; baseValue = 90; }
  else if (timeframe === '1M') { points = 30; volatility = 25; baseValue = 80; }
  else if (timeframe === '3M') { points = 90; volatility = 40; baseValue = 60; }
  else if (timeframe === 'All') { points = 12; volatility = 50; baseValue = 50; }

  let currentValue = baseValue;
  for (let i = 0; i <= points; i++) {
    currentValue = currentValue + (Math.random() - 0.4) * volatility;
    let timeLabel = '';
    const d = new Date();
    if (timeframe === '1D') {
      d.setHours(d.getHours() - (points - i));
      timeLabel = d.toLocaleTimeString(undefined, { hour: 'numeric', hour12: true });
    } else if (timeframe === '1W') {
      d.setDate(d.getDate() - (points - i));
      timeLabel = d.toLocaleDateString(undefined, { weekday: 'short' });
    } else if (timeframe === '1M') {
      d.setDate(d.getDate() - (points - i));
      timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else if (timeframe === '3M') {
      d.setDate(d.getDate() - (points - i));
      timeLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else {
      d.setMonth(d.getMonth() - (points - i));
      timeLabel = d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }
    data.push({ time: timeLabel, value: Math.max(0.1, currentValue) });
  }
  return data;
};

const BREAKDOWN_DATA = [
  { name: 'Wallet', value: 45, color: '#cda169' },
  { name: 'DeFi', value: 28, color: '#7b68ee' },
  { name: 'LP', value: 17, color: '#36c690' },
  { name: 'NFTs', value: 10, color: '#e06a6a' },
];

const PROTOCOL_BREAKDOWN_DATA = [
  { name: 'Holding', value: 42, color: '#cda169' },
  { name: 'Echelon', value: 18, color: '#7b68ee' },
  { name: 'Meridian', value: 15, color: '#36c690' },
  { name: 'Joule', value: 10, color: '#e06a6a' },
  { name: 'Others', value: 15, color: '#9ca3af' },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="history-tooltip">
        <div className="tooltip-date">{label}</div>
        <div className="tooltip-value-row">
          <span className="tooltip-label">Net worth</span>
          <span className="tooltip-value">${payload[0].value.toFixed(2)}</span>
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
}

const PNLChart: React.FC<PNLChartProps> = ({
  hideValues = false,
  setHideValues,
  handleRefresh,
  isRefreshing = false,
  lastRefresh = 0
}) => {
  const [timeframe, setTimeframe] = useState('1D');
  const [activeTab, setActiveTab] = useState('History');
  const [breakdownType, setBreakdownType] = useState('Asset');
  const [activeIndex, setActiveIndex] = useState(-1);
  const data = useMemo(() => generateMockData(timeframe), [timeframe]);

  const totalValue = 0.02; // Mock total value matching the UI
  const currentBreakdownData = breakdownType === 'Asset' ? BREAKDOWN_DATA : PROTOCOL_BREAKDOWN_DATA;

  const firstVal = data[0]?.value ?? 0;
  const lastVal = data[data.length - 1]?.value ?? 0;
  const isPositive = lastVal >= firstVal;
  const changeUSD = Math.abs(lastVal - firstVal).toFixed(2);
  const changePercent = firstVal > 0 ? (((lastVal - firstVal) / firstVal) * 100).toFixed(2) : '0.00';
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            {activeTab === 'History' && <span>History</span>}
          </button>
          <button
            className={`segment-btn ${activeTab === 'Breakdown' ? 'active' : ''}`}
            onClick={() => setActiveTab('Breakdown')}
            title="Breakdown"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            {activeTab === 'Breakdown' && <span>Breakdown</span>}
          </button>
        </div>

        {activeTab === 'History' && (
          <div className="timeframe-selectors-v4">
            {TIME_FRAMES.map((tf) => (
              <button
                key={tf}
                className={`tf-btn-v4 ${timeframe === tf ? 'active' : ''}`}
                onClick={() => setTimeframe(tf)}
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
            <ResponsiveContainer width="99%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
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
                  tick={{ fill: 'rgba(255, 255, 255, 0.28)', fontSize: 10, fontFamily: 'var(--font-primary)' }}
                  dy={8}
                  minTickGap={40}
                />
                <YAxis hide={true} domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, strokeDasharray: '4 4' }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={strokeColor}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill={`url(#${gradientId})`}
                  activeDot={{ r: 4, fill: '#fff', stroke: strokeColor, strokeWidth: 2 }}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Breakdown View */}
      {activeTab === 'Breakdown' && (
        <div className="pnl-breakdown-view">
          <div className="breakdown-donut-area">
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
            <div className="donut-center-label">
              <span className="donut-total-label">
                {activeIndex === -1 ? 'Total' : currentBreakdownData[activeIndex].name}
              </span>
              <span className="donut-total-value">
                {activeIndex === -1
                  ? `$${totalValue.toFixed(2)}`
                  : `$${(totalValue * (currentBreakdownData[activeIndex].value / 100)).toFixed(4)}`
                }
              </span>
            </div>
          </div>

          <div className={`breakdown-legend ${activeIndex !== -1 ? 'is-hovering' : ''}`}>
            {currentBreakdownData.map((item, index) => (
              <div
                className={`breakdown-legend-item ${activeIndex === index ? 'active' : ''}`}
                key={item.name}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(-1)}
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
