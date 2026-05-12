import React, { useState } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid 
} from 'recharts';
import { motion } from 'framer-motion';
import './AnalyticsView.css';

const TIME_FRAMES = ['1W', '1M', '3M', '1Y', 'All'];

const MOCK_PNL_DATA = [
  { date: '2026-05-01', value: 1200, pnl: 0 },
  { date: '2026-05-02', value: 1250, pnl: 50 },
  { date: '2026-05-03', value: 1450, pnl: 250 },
  { date: '2026-05-04', value: 1320, pnl: 120 },
  { date: '2026-05-05', value: 1680, pnl: 480 },
  { date: '2026-05-06', value: 1800, pnl: 600 },
  { date: '2026-05-07', value: 2100, pnl: 900 },
  { date: '2026-05-08', value: 1950, pnl: 750 },
  { date: '2026-05-09', value: 2050, pnl: 850 },
  { date: '2026-05-10', value: 2450, pnl: 1250 },
  { date: '2026-05-11', value: 2380, pnl: 1180 },
  { date: '2026-05-12', value: 2540, pnl: 1340 },
];

const PROTOCOL_STATS = [
  { name: 'Liquidswap', value: 45, color: '#cda169', txs: 124, volume: '$12,450', action: 'Swapping' },
  { name: 'Echelon', value: 25, color: '#36c690', txs: 42, volume: '$8,200', action: 'Lending' },
  { name: 'Meridian', value: 15, color: '#7b68ee', txs: 18, volume: '$2,100', action: 'Trading' },
  { name: 'Others', value: 15, color: '#9ca3af', txs: 12, volume: '$540', action: 'Various' },
];

const TOP_ASSETS = [
  { symbol: 'MOVE', name: 'Movement', profit: '+$450.20', change: '+12.4%', color: '#cda169', icon: 'M' },
  { symbol: 'WETH', name: 'Ethereum', profit: '+$120.50', change: '+4.2%', color: '#627eea', icon: 'E' },
  { symbol: 'USDC', name: 'USD Coin', profit: '+$12.00', change: '+0.1%', color: '#2775ca', icon: 'U' },
];

const RECENT_INSIGHTS = [
  { 
    id: 1, 
    type: 'opportunity', 
    title: 'Yield Optimization', 
    desc: 'You have $540 in idle USDC. Echelon is offering 4.2% APY on USDC supplies right now.', 
    icon: '💡',
    cta: 'View Echelon'
  },
  { 
    id: 2, 
    type: 'risk', 
    title: 'High Correlation', 
    desc: 'Your portfolio is 85% correlated with MOVE. Consider diversifying into stablecoins.', 
    icon: '🛡️',
    cta: 'Diversify'
  },
  { 
    id: 3, 
    type: 'achievement', 
    title: 'Liquidswap Power User', 
    desc: 'You are in the top 5% of Liquidswap traders this month. Keep it up!', 
    icon: '🏆',
    cta: 'View Leaderboard'
  }
];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="analytics-tooltip-v2">
        <div className="tooltip-date">{new Date(payload[0].payload.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
        <div className="tooltip-row">
          <span className="label">Portfolio Value</span>
          <span className="value">${payload[0].value.toLocaleString()}</span>
        </div>
        <div className="tooltip-row">
          <span className="label">Total PnL</span>
          <span className="value positive">+${payload[0].payload.pnl.toLocaleString()}</span>
        </div>
      </div>
    );
  }
  return null;
};

const AnalyticsView: React.FC = () => {
  const [timeframe, setTimeframe] = useState('1M');
  const [hoveredProtocol, setHoveredProtocol] = useState<number | null>(null);

  return (
    <div className="analytics-page-v4">
      {/* Header Summary Section */}
      <div className="analytics-header-grid">
        <motion.div 
          className="analytics-summary-card pnl"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="summary-label">Lifetime Performance</div>
          <div className="summary-main-val">+$1,340.42</div>
          <div className="summary-sub-row">
            <span className="summary-badge positive">+21.8%</span>
            <span className="summary-context">since first transaction</span>
          </div>
          <div className="card-decoration">
            <svg viewBox="0 0 200 100" className="bg-chart-svg">
              <path d="M0,80 Q50,70 100,40 T200,20 L200,100 L0,100 Z" fill="url(#cardGrad)" opacity="0.1" />
              <defs>
                <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </motion.div>

        <div className="analytics-stats-capsules">
          <div className="stat-capsule">
            <div className="stat-cap-icon">📊</div>
            <div className="stat-cap-info">
              <span className="stat-cap-label">Total Volume</span>
              <span className="stat-cap-val">$24,850</span>
            </div>
          </div>
          <div className="stat-capsule">
            <div className="stat-cap-icon">⛽</div>
            <div className="stat-cap-info">
              <span className="stat-cap-label">Gas Spent</span>
              <span className="stat-cap-val">$14.20</span>
            </div>
          </div>
          <div className="stat-capsule">
            <div className="stat-cap-icon">🔄</div>
            <div className="stat-cap-info">
              <span className="stat-cap-label">Interactions</span>
              <span className="stat-cap-val">196</span>
            </div>
          </div>
        </div>
      </div>

      <div className="analytics-content-layout">
        {/* Main Chart Area */}
        <div className="analytics-main-column">
          <div className="analytics-card-v4 chart-card">
            <div className="card-header-v4">
              <h3 className="card-title-v4">PnL History</h3>
              <div className="time-selectors-v4">
                {TIME_FRAMES.map(tf => (
                  <button 
                    key={tf} 
                    className={`time-btn-v4 ${timeframe === tf ? 'active' : ''}`}
                    onClick={() => setTimeframe(tf)}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="big-chart-container">
              <ResponsiveContainer width="100%" height={340}>
                <AreaChart data={MOCK_PNL_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mainPnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                    tickFormatter={(str) => new Date(str).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    minTickGap={30}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke="var(--primary)" 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#mainPnlGrad)" 
                    activeDot={{ r: 6, fill: '#fff', stroke: 'var(--primary)', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="analytics-grid-two">
            <div className="analytics-card-v4">
              <h3 className="card-title-v4">Top Performing Assets</h3>
              <div className="asset-list-v4">
                {TOP_ASSETS.map((asset, i) => (
                  <motion.div 
                    className="asset-item-v4" 
                    key={asset.symbol}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="asset-item-left">
                      <div className="asset-avatar-v4" style={{ background: asset.color }}>{asset.icon}</div>
                      <div className="asset-name-group">
                        <span className="asset-sym">{asset.symbol}</span>
                        <span className="asset-full">{asset.name}</span>
                      </div>
                    </div>
                    <div className="asset-item-right">
                      <span className="asset-profit positive">{asset.profit}</span>
                      <span className="asset-change positive">{asset.change}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="analytics-card-v4">
              <h3 className="card-title-v4">Smart Insights</h3>
              <div className="insights-list-v4">
                {RECENT_INSIGHTS.map((insight) => (
                  <div className={`insight-item-v4 ${insight.type}`} key={insight.id}>
                    <div className="insight-top">
                      <span className="insight-icon-v4">{insight.icon}</span>
                      <span className="insight-title-v4">{insight.title}</span>
                    </div>
                    <p className="insight-desc-v4">{insight.desc}</p>
                    <button className="insight-cta-v4">{insight.cta} →</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Side Column */}
        <div className="analytics-side-column">
          <div className="analytics-card-v4 affinity-card">
            <h3 className="card-title-v4">Protocol Usage</h3>
            <div className="affinity-visual">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={PROTOCOL_STATS}
                    innerRadius={70}
                    outerRadius={90}
                    paddingAngle={8}
                    dataKey="value"
                    stroke="none"
                    onMouseEnter={(_, index) => setHoveredProtocol(index)}
                    onMouseLeave={() => setHoveredProtocol(null)}
                  >
                    {PROTOCOL_STATS.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.color} 
                        opacity={hoveredProtocol === null || hoveredProtocol === index ? 1 : 0.4}
                        style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="affinity-center-label">
                <span className="aff-val">
                  {hoveredProtocol !== null ? PROTOCOL_STATS[hoveredProtocol].value + '%' : '100%'}
                </span>
                <span className="aff-lab">
                  {hoveredProtocol !== null ? PROTOCOL_STATS[hoveredProtocol].name : 'Total Usage'}
                </span>
              </div>
            </div>
            <div className="affinity-legend-v4">
              {PROTOCOL_STATS.map((p, i) => (
                <div 
                  className={`aff-legend-item ${hoveredProtocol === i ? 'active' : ''}`} 
                  key={p.name}
                  onMouseEnter={() => setHoveredProtocol(i)}
                  onMouseLeave={() => setHoveredProtocol(null)}
                >
                  <div className="aff-legend-left">
                    <span className="aff-dot" style={{ background: p.color }}></span>
                    <div className="aff-name-group">
                      <span className="aff-name">{p.name}</span>
                      <span className="aff-action">{p.action}</span>
                    </div>
                  </div>
                  <div className="aff-legend-right">
                    <span className="aff-vol">{p.volume}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="analytics-card-v4 efficiency-card">
            <h3 className="card-title-v4">Activity Breakdown</h3>
            <div className="mini-bar-chart">
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={[
                  { name: 'Swap', val: 124 },
                  { name: 'Dep', val: 42 },
                  { name: 'LP', val: 18 },
                  { name: 'NFT', val: 12 },
                ]}>
                  <Bar dataKey="val" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="efficiency-note">Your activity is primarily focused on Decentralized Exchanges (65% of total interactions).</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsView;
