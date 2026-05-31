import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { AnalyticsData } from '../../types/analytics.types';
import { Activity, Droplets, LayoutTemplate, Ghost } from 'lucide-react';
import TopEntities from './TopEntities';
import AnalyticsTooltip from './AnalyticsTooltip';
import { DATA_VIZ_COLORS } from '../../config/display';

interface AnalyticsOverviewProps {
  data: AnalyticsData;
  bottomData: AnalyticsData;
  timeframe: string;
  setTimeframe: (tf: string) => void;
  bottomTimeframe: string;
  setBottomTimeframe: (tf: string, startDate?: string, endDate?: string) => void;
}

const TIME_FRAMES = ['1D', '1W', '1M', '3M', '1Y', 'All'];

const AnalyticsOverview: React.FC<AnalyticsOverviewProps> = ({
  data,
  bottomData,
  timeframe,
  setTimeframe,
  bottomTimeframe,
  setBottomTimeframe
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
            <div className="analytics-tab-header-left">
              <button
                className={`analytics-tab-btn ${activeChartTab === 'balance' ? 'active' : ''}`}
                onClick={() => setActiveChartTab('balance')}
              >
                Token Balance
              </button>
              <button
                className={`analytics-tab-btn ${activeChartTab === 'flow' ? 'active' : ''}`}
                onClick={() => setActiveChartTab('flow')}
              >
                Capital Flow
              </button>
              <button
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
            <div className="tabs-container-v5">
              {TIME_FRAMES.map(tf => (
                <button
                  key={tf}
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
          <div className="mini-stat-v5">
            <div className="mini-stat-left">
              <Droplets size={16} color="#36c690" />
              <span className="mini-stat-label">Inflow</span>
            </div>
            <span className="mini-stat-value positive">{formatVolumeValue(data.totalInflow).replace('$', '+$')}</span>
          </div>
          <div className="mini-stat-v5">
            <div className="mini-stat-left">
              <Droplets size={16} color="#ff4b4b" style={{ transform: 'rotate(180deg)' }} />
              <span className="mini-stat-label">Outflow</span>
            </div>
            <span className="mini-stat-value negative">{formatVolumeValue(data.totalOutflow).replace('$', '-$')}</span>
          </div>
          <div className="mini-stat-v5">
            <div className="mini-stat-left">
              <Activity size={16} color="var(--primary)" />
              <span className="mini-stat-label">Total Transactions</span>
            </div>
            <span className="mini-stat-value">{data.interactionCount}</span>
          </div>

          <div className="bento-card" style={{ flex: 1, marginTop: '8px' }}>
            <h3 className="bento-title">
              <LayoutTemplate size={18} className="bento-icon" />
              Protocol Affinity
            </h3>
            <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {!hasProtocols ? (
                <div className="empty-state-v5">
                  <Ghost size={28} className="empty-state-icon" style={{ marginBottom: 8 }} />
                  <p style={{ fontSize: '13px' }}>No protocols detected.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }} />
                    <Pie data={data.protocolUsage} innerRadius={60} outerRadius={75} paddingAngle={6} dataKey="value" stroke="none" nameKey="name">
                      {data.protocolUsage.map((entry, index) => {
                        const fillCol = DATA_VIZ_COLORS[index % DATA_VIZ_COLORS.length];
                        return <Cell key={`cell-${index}`} fill={fillCol} />;
                      })}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      <TopEntities data={bottomData} timeframe={bottomTimeframe} setTimeframe={setBottomTimeframe} />
    </div>
  );
};

export default AnalyticsOverview;
