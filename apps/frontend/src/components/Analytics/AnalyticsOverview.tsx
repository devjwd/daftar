import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { AnalyticsData } from '../../types/analytics.types';
import { Activity, LayoutTemplate, Ghost } from 'lucide-react';
import TopEntities from './TopEntities';
import AnalyticsTooltip from './AnalyticsTooltip';
import { DATA_VIZ_COLORS } from '../../config/display';

interface AnalyticsOverviewProps {
  data: AnalyticsData;
  timeframe: string;
  setTimeframe: (tf: string) => void;
}

const TIME_FRAMES = ['1D', '1W', '1M', '3M', '1Y', 'All'];

const AnalyticsOverview: React.FC<AnalyticsOverviewProps> = ({
  data,
  timeframe,
  setTimeframe
}) => {
  const [activeChartTab, setActiveChartTab] = useState<'balance' | 'flow' | 'txs'>('balance');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const chartData = activeChartTab === 'balance'
    ? (data.tokenBalanceHistory && data.tokenBalanceHistory.length > 0 ? data.tokenBalanceHistory : [])
    : (data.activityHistory && data.activityHistory.length > 0 ? data.activityHistory : []);

  const hasHistory = chartData && chartData.length > 0;
  const hasProtocols = data.protocolUsage && data.protocolUsage.length > 0;

  const formatVolumeValue = (val: number): string => {
    const absVal = Math.abs(val);
    if (absVal === 0) return '$0';
    if (absVal < 0.001) return `$${val.toFixed(6)}`;
    if (absVal < 0.01) return `$${val.toFixed(4)}`;
    if (absVal < 1) return `$${val.toFixed(3)}`;
    if (absVal < 10) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };

  return (
    <div className="analytics-overview-v5">
      <div className="overview-grid-v5">
        {/* Main PNL & History Card */}
        <div className="bento-card">

          {/* Top Header Row */}
          <div className="analytics-tab-header">
            <div className="analytics-tab-header-left" role="tablist" aria-label="Chart Views">
              <button
                role="tab"
                aria-selected={activeChartTab === 'balance'}
                className={`analytics-tab-btn ${activeChartTab === 'balance' ? 'active' : ''}`}
                onClick={() => setActiveChartTab('balance')}
              >
                Token Balance
              </button>
              <button
                role="tab"
                aria-selected={activeChartTab === 'flow'}
                className={`analytics-tab-btn ${activeChartTab === 'flow' ? 'active' : ''}`}
                onClick={() => setActiveChartTab('flow')}
              >
                Capital Flow
              </button>
              <button
                role="tab"
                aria-selected={activeChartTab === 'txs'}
                className={`analytics-tab-btn ${activeChartTab === 'txs' ? 'active' : ''}`}
                onClick={() => setActiveChartTab('txs')}
              >
                Transactions
              </button>
            </div>
          </div>

          {/* Stats section below the header row */}
          <div className="analytics-stats-header">
            <div className="analytics-stats-left">
              <span className="exchange-label">
                {activeChartTab === 'balance' ? 'Token Balance' : activeChartTab === 'flow' ? 'Total Capital Flow' : 'Transaction Count'}
              </span>
              <div className="hero-value">
                {activeChartTab === 'balance' ? formatVolumeValue(data.totalBalance ?? 0) : activeChartTab === 'flow' ? formatVolumeValue(data.totalVolume) : data.interactionCount.toLocaleString()}
              </div>
              <div className="analytics-months-badge">
                <span>{data.activeMonths} Months</span>
                of tracked activity
              </div>
            </div>

            {/* Timeframe Selector */}
            <div className="tabs-container-v5" style={{ alignSelf: 'flex-end', marginBottom: '8px' }} role="tablist" aria-label="Timeframes">
              {TIME_FRAMES.map(tf => (
                <button
                  key={tf}
                  role="tab"
                  aria-selected={timeframe === tf}
                  className={`tab-v5 ${timeframe === tf ? 'active' : ''}`}
                  onClick={() => {
                    if (tf !== timeframe) {
                      setIsTransitioning(true);
                      setTimeframe(tf);
                      setTimeout(() => setIsTransitioning(false), 400);
                    }
                  }}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className={`analytics-chart-wrap${isTransitioning ? ' transitioning' : ''}`}>
            {!hasHistory ? (
              <div className="empty-state-v5" style={{ height: '100%' }}>
                <Ghost size={32} className="empty-state-icon" />
                <p>No activity recorded in this timeframe.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData as any[]}>
                  <defs>
                    <linearGradient id="balanceGradV5" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="pnlGradV5" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="txsGradV5" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#36c690" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#36c690" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'rgba(255, 255, 255, 0.8)', fontSize: 11 }}
                    minTickGap={40}
                    dy={10}
                    tickFormatter={(val) => {
                      const d = new Date(val);
                      if (isNaN(d.getTime())) return '';
                      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    }}
                  />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip content={(props) => <AnalyticsTooltip {...props} activeChartTab={activeChartTab} formatVolumeValue={formatVolumeValue} />} />
                  {activeChartTab === 'balance' ? (
                    <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={3} fillOpacity={1} fill="url(#balanceGradV5)" isAnimationActive={true} animationDuration={600} animationEasing="ease-in-out" />
                  ) : activeChartTab === 'flow' ? (
                    <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={3} fillOpacity={1} fill="url(#pnlGradV5)" isAnimationActive={true} animationDuration={600} animationEasing="ease-in-out" />
                  ) : (
                    <Area type="monotone" dataKey="txCount" stroke="#36c690" strokeWidth={3} fillOpacity={1} fill="url(#txsGradV5)" isAnimationActive={true} animationDuration={600} animationEasing="ease-in-out" />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Side Stats & Protocol Affinity */}
        <div className="stats-column-v5">
          <div className="bento-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Minimal Activity Summary Row */}
            <div>
              <h3 className="bento-title" style={{ margin: '0 0 16px 0', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                <Activity size={16} className="bento-icon" />
                Activity Summary
              </h3>
              <div className="minimal-stats-row">
                
                {/* INFLOW */}
                <div className="minimal-stat-col">
                  <span className="stat-label">Inflow</span>
                  <span className="stat-value inflow">
                    {formatVolumeValue(data.totalInflow).replace('$', '+$')}
                  </span>
                </div>

                {/* OUTFLOW */}
                <div className="minimal-stat-col">
                  <span className="stat-label">Outflow</span>
                  <span className="stat-value outflow">
                    {formatVolumeValue(data.totalOutflow).replace('$', '-$')}
                  </span>
                </div>

                {/* TRANSACTIONS */}
                <div className="minimal-stat-col">
                  <span className="stat-label">Transactions</span>
                  <span className="stat-value">
                    {data.interactionCount.toLocaleString()}
                  </span>
                </div>

              </div>
            </div>

            {/* Divider Line */}
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0 -4px' }} />

            {/* Protocol Affinity Section */}
            <div>
              <h3 className="bento-title" style={{ margin: '0 0 16px 0', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                <LayoutTemplate size={16} className="bento-icon" />
                Protocol Affinity
              </h3>
              {!hasProtocols ? (
                <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="empty-state-v5">
                    <Ghost size={28} className="empty-state-icon" style={{ marginBottom: 8 }} />
                    <p style={{ fontSize: '13px' }}>No protocols detected.</p>
                  </div>
                </div>
              ) : (
                (() => {
                  const totalProtocolValue = data.protocolUsage ? data.protocolUsage.reduce((acc, curr) => acc + curr.value, 0) : 0;
                  const sortedProtocols = data.protocolUsage ? [...data.protocolUsage].sort((a, b) => b.value - a.value) : [];

                  return (
                    <div className="affinity-content-row" style={{ display: 'flex', alignItems: 'center', gap: '20px', minHeight: '180px' }}>
                      <div style={{ width: '42%', height: '170px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                            <Pie 
                              data={sortedProtocols} 
                              innerRadius={44} 
                              outerRadius={58} 
                              paddingAngle={sortedProtocols.length > 1 ? 2 : 0} 
                              dataKey="value" 
                              stroke="none" 
                              nameKey="name"
                            >
                              {sortedProtocols.map((entry, index) => {
                                const fillCol = DATA_VIZ_COLORS[index % DATA_VIZ_COLORS.length];
                                return <Cell key={`cell-${index}`} fill={fillCol} />;
                              })}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ width: '58%', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }} className="custom-scrollbar">
                        {sortedProtocols.map((item, index) => {
                          const pct = totalProtocolValue > 0 ? ((item.value / totalProtocolValue) * 100).toFixed(1) : '0';
                          const fillCol = DATA_VIZ_COLORS[index % DATA_VIZ_COLORS.length];
                          return (
                            <div key={item.name} className="legend-item-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255, 255, 255, 0.03)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: fillCol, flexShrink: 0 }} />
                                <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.name}
                                </span>
                              </div>
                              <span style={{ fontSize: '11px', fontWeight: 800, color: 'rgba(255,255,255,0.4)', marginLeft: '6px', flexShrink: 0 }}>
                                {pct}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {/* Divider Line */}
          </div>
        </div>
      </div>

      <TopEntities data={data} timeframe={timeframe} />
    </div>
  );
};

export default AnalyticsOverview;
