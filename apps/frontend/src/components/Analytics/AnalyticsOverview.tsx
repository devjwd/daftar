import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { AnalyticsData } from '../../types/analytics.types';
import { Activity, Droplets, LayoutTemplate, Ghost } from 'lucide-react';
import TopEntities from './TopEntities';

interface AnalyticsOverviewProps {
  data: AnalyticsData;
  timeframe: string;
  setTimeframe: (tf: string) => void;
}

const TIME_FRAMES = ['1W', '1M', '3M', '1Y', 'All'];

const AnalyticsOverview: React.FC<AnalyticsOverviewProps> = ({ data, timeframe, setTimeframe }) => {
  const chartData = data.networthHistory && data.networthHistory.length > 0 ? data.networthHistory : data.activityHistory;
  const hasHistory = chartData && chartData.length > 0;
  const hasProtocols = data.protocolUsage && data.protocolUsage.length > 0;

  // Calculate current performance if using networthHistory
  const currentNetworth = chartData[chartData.length - 1]?.value || 0;
  const isNetworthMode = !!data.networthHistory?.length;

  return (
    <div className="analytics-overview-v5">
      <div className="overview-grid-v5">
        {/* Main PNL & History Card */}
        <div className="bento-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
            <div>
              <span className="exchange-label" style={{ display: 'block', marginBottom: '8px' }}>{isNetworthMode ? 'Current Net Worth' : 'Total Capital Flow'}</span>
              <div className="hero-value">${(isNetworthMode ? currentNetworth : data.totalVolume).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              <div style={{ marginTop: '8px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                <span style={{ background: 'rgba(205,161,105,0.1)', color: 'var(--primary)', padding: '4px 8px', borderRadius: '6px', fontWeight: 800 }}>
                  {isNetworthMode ? 'Live Snapshots' : `${data.activeMonths} Months`}
                </span>
                {' '} {isNetworthMode ? 'Including DeFi & LP' : 'of tracked activity'}
              </div>
            </div>
            <div className="tabs-container-v5" style={{ marginBottom: 0 }}>
              {TIME_FRAMES.map(tf => (
                <button 
                  key={tf} 
                  className={`tab-v5 ${timeframe === tf ? 'active' : ''}`}
                  onClick={() => setTimeframe(tf)}
                  style={{ padding: '6px 14px', fontSize: '12px' }}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: '320px', width: '100%', marginLeft: '-12px' }}>
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
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: 'var(--text-quaternary)', fontSize: 11 }} 
                    minTickGap={40} 
                    dy={10} 
                    tickFormatter={(val) => {
                      const d = new Date(val);
                      return isNetworthMode ? `${d.getHours()}:00` : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    }}
                  />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip 
                    labelFormatter={(label) => new Date(label).toLocaleString()}
                    contentStyle={{ background: 'rgba(26,26,26,0.8)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff', fontWeight: 700 }} 
                    itemStyle={{ color: 'var(--primary)' }}
                    formatter={(value: any) => [`$${Number(value).toLocaleString()}`, 'Value']}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={3} fillOpacity={1} fill="url(#pnlGradV5)" isAnimationActive={true} />
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
            <span className="mini-stat-value positive">+${data.totalInflow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="mini-stat-v5">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Droplets size={16} color="#ff4b4b" style={{ transform: 'rotate(180deg)' }} />
              <span className="mini-stat-label">Outflow</span>
            </div>
            <span className="mini-stat-value negative">-${data.totalOutflow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="mini-stat-v5">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={16} color="var(--primary)" />
              <span className="mini-stat-label">Interactions</span>
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
                        {data.protocolUsage.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color || '#fff'} />))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
               )}
            </div>
          </div>
        </div>
      </div>

      <TopEntities data={data} />
    </div>
  );
};

export default AnalyticsOverview;
