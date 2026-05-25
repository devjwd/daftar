import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { AnalyticsData } from '../../types/analytics.types';
import { Activity, Droplets, LayoutTemplate, Ghost } from 'lucide-react';
import TopEntities from './TopEntities';

interface AnalyticsOverviewProps {
  data: AnalyticsData;
  bottomData: AnalyticsData;
  timeframe: string;
  setTimeframe: (tf: string) => void;
  bottomTimeframe: string;
  setBottomTimeframe: (tf: string) => void;
}

const TIME_FRAMES = ['1D', '1W', '1M', '3M', '1Y', 'All'];

const GOLD_DONUT_COLORS = [
  '#cda169', // Main Brand Gold
  '#e5be8a', // Light Warm Amber
  '#b2854f', // Deep Bronze
  '#895f2d', // Copper Brown
  '#f4d9b1', // Champagne
  '#5b3d1b', // Dark Earth Gold
];

const AnalyticsOverview: React.FC<AnalyticsOverviewProps> = ({ 
  data, 
  bottomData, 
  timeframe, 
  setTimeframe,
  bottomTimeframe,
  setBottomTimeframe
}) => {
  const [activeChartTab, setActiveChartTab] = useState<'flow' | 'txs'>('flow');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const chartData = data.activityHistory && data.activityHistory.length > 0 ? data.activityHistory : [];

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

  const CustomChartTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const point = payload[0].payload;
    const dateStr = point.date;

    const d = new Date(dateStr);
    const formattedDate = isNaN(d.getTime())
      ? dateStr
      : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

    const dateKey = dateStr.split('T')[0];
    const activityPoint = point;

    const value = payload[0].value;

    const renderDetailsList = (details: Array<{ name: string; value: number }>, prefix: string, color: string) => {
      if (!details || details.length === 0) return null;
      return (
        <div style={{ marginTop: '6px' }}>
          {details.map((detail, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(255,255,255,0.7)', paddingLeft: '8px', margin: '2px 0' }}>
              <span>• {detail.name}</span>
              <span style={{ color, fontWeight: 700 }}>
                {prefix}{formatVolumeValue(detail.value)}
              </span>
            </div>
          ))}
        </div>
      );
    };

    return (
      <div style={{
        background: 'rgba(15, 15, 15, 0.85)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(205, 161, 105, 0.2)',
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        maxWidth: '300px',
        minWidth: '220px',
        color: '#fff'
      }}>
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
          {formattedDate}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>
            {activeChartTab === 'flow' ? 'Cumulative Volume' : 'Transactions'}
          </span>
          <span style={{
            fontSize: '14px',
            fontWeight: 900,
            color: activeChartTab === 'flow' ? 'var(--primary)' : '#36c690'
          }}>
            {activeChartTab === 'flow' ? formatVolumeValue(value) : Number(value).toLocaleString()}
          </span>
        </div>

        <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '8px 0' }}></div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 800, marginBottom: '6px' }}>
            Daily Transfers
          </div>

          {activityPoint && (Number(activityPoint.inflow || 0) > 0 || Number(activityPoint.outflow || 0) > 0) ? (
            <>
              {Number(activityPoint.inflow || 0) > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#36c690', fontWeight: 700 }}>
                    <span>Received (Inflow)</span>
                    <span>+{formatVolumeValue(activityPoint.inflow)}</span>
                  </div>
                  {renderDetailsList(activityPoint.inflowDetails || [], '+', '#36c690')}
                </div>
              )}

              {Number(activityPoint.outflow || 0) > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ff4b4b', fontWeight: 700 }}>
                    <span>Sent (Outflow)</span>
                    <span>-{formatVolumeValue(activityPoint.outflow)}</span>
                  </div>
                  {renderDetailsList(activityPoint.outflowDetails || [], '-', '#ff4b4b')}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
              No deposits or withdrawals
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="analytics-overview-v5">
      <div className="overview-grid-v5">
        {/* Main PNL & History Card */}
        <div className="bento-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '32px' }}>
            <div>
              <span className="exchange-label" style={{ display: 'block', marginBottom: '8px' }}>
                {activeChartTab === 'flow' ? 'Total Capital Flow' : 'Transaction Count'}
              </span>
              <div className="hero-value">
                {activeChartTab === 'flow' ? formatVolumeValue(data.totalVolume) : data.interactionCount.toLocaleString()}
              </div>
              <div style={{ marginTop: '8px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                <span style={{ background: 'rgba(205,161,105,0.1)', color: 'var(--primary)', padding: '4px 8px', borderRadius: '6px', fontWeight: 800 }}>
                  {data.activeMonths} Months
                </span>
                {' '} of tracked activity
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Chart Type Selector */}
              <div className="tabs-container-v5" style={{ margin: 0 }}>
                <button
                  className={`tab-v5 ${activeChartTab === 'flow' ? 'active' : ''}`}
                  onClick={() => setActiveChartTab('flow')}
                  style={{ padding: '6px 14px', fontSize: '12px' }}
                >
                  Capital Flow
                </button>
                <button
                  className={`tab-v5 ${activeChartTab === 'txs' ? 'active' : ''}`}
                  onClick={() => setActiveChartTab('txs')}
                  style={{ padding: '6px 14px', fontSize: '12px' }}
                >
                  Transactions
                </button>
              </div>

              {/* Timeframe Selector */}
              <div className="tabs-container-v5" style={{ margin: 0 }}>
                {TIME_FRAMES.map(tf => (
                  <button 
                    key={tf} 
                    className={`tab-v5 ${timeframe === tf ? 'active' : ''}`}
                    onClick={() => {
                      if (tf !== timeframe) {
                        setIsTransitioning(true);
                        setTimeframe(tf);
                        // Clear transition after data should have loaded
                        setTimeout(() => setIsTransitioning(false), 400);
                      }
                    }}
                    style={{ padding: '6px 14px', fontSize: '12px' }}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ height: '320px', width: '100%', marginLeft: '-12px', transition: 'opacity 0.3s ease, filter 0.3s ease', opacity: isTransitioning ? 0.4 : 1, filter: isTransitioning ? 'blur(1px)' : 'none' }}>
            {!hasHistory ? (
               <div className="empty-state-v5" style={{ height: '100%' }}>
                  <Ghost size={32} className="empty-state-icon" />
                  <p>No activity recorded in this timeframe.</p>
               </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
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
                  <Tooltip content={<CustomChartTooltip />} />
                  {activeChartTab === 'flow' ? (
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Droplets size={16} color="#36c690" />
              <span className="mini-stat-label">Inflow</span>
            </div>
            <span className="mini-stat-value positive">{formatVolumeValue(data.totalInflow).replace('$', '+$')}</span>
          </div>
          <div className="mini-stat-v5">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Droplets size={16} color="#ff4b4b" style={{ transform: 'rotate(180deg)' }} />
              <span className="mini-stat-label">Outflow</span>
            </div>
            <span className="mini-stat-value negative">{formatVolumeValue(data.totalOutflow).replace('$', '-$')}</span>
          </div>
          <div className="mini-stat-v5">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                          const fillCol = GOLD_DONUT_COLORS[index % GOLD_DONUT_COLORS.length];
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
