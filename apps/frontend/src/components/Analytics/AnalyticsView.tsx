import React, { useState, useEffect, useMemo } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid 
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import './AnalyticsView.css';

interface AnalyticsViewProps {
  walletAddress?: string;
}

const TIME_FRAMES = ['1W', '1M', '3M', '1Y', 'All'];

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ walletAddress }) => {
  const [timeframe, setTimeframe] = useState('1M');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'completed' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Poll sync status if syncing
  useEffect(() => {
    let interval: any;
    if (syncStatus === 'syncing' && walletAddress) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${process.env.VITE_API_URL || ''}/api/analytics/status?wallet=${walletAddress}`);
          const data = await res.json();
          if (data.full_history_synced) {
            setSyncStatus('completed');
            fetchAnalyticsData();
            clearInterval(interval);
          }
          if (data.last_synced_version) {
            // Mock increment for visual feedback
            setSyncProgress(prev => Math.min(prev + 5, 99));
          }
        } catch (err) {
          console.error("Status polling error:", err);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [syncStatus, walletAddress]);

  const fetchAnalyticsData = async () => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const res = await fetch(`${process.env.VITE_API_URL || ''}/api/analytics/data?wallet=${walletAddress}`);
      const data = await res.json();
      setAnalyticsData(data);
    } catch (err) {
      console.error("Fetch analytics error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSync = async () => {
    if (!walletAddress) return;
    setSyncStatus('syncing');
    setSyncProgress(0);
    try {
      await fetch(`${process.env.VITE_API_URL || ''}/api/analytics/sync?wallet=${walletAddress}`);
    } catch (err) {
      setSyncStatus('error');
      console.error("Sync trigger error:", err);
    }
  };

  // If no data and not syncing, we show the "Empty State" with the Scan Button
  const isInitialState = !analyticsData && syncStatus === 'idle';

  return (
    <div className="analytics-page-v4">
      {/* Top Action Bar */}
      <div className="analytics-action-bar">
        <div className="sync-info">
          <h2 className="analytics-title">Portfolio Intelligence</h2>
          <p className="analytics-subtitle">Institutional-grade lifetime performance tracking</p>
        </div>
        
        <div className="sync-actions">
          {syncStatus === 'syncing' ? (
            <div className="sync-progress-container">
              <div className="sync-spinner"></div>
              <div className="sync-text-group">
                <span className="sync-main-text">Extracting Movement History...</span>
                <span className="sync-sub-text">{syncProgress}% Complete</span>
              </div>
            </div>
          ) : (
            <button 
              className={`deep-scan-btn ${syncStatus === 'completed' ? 'secondary' : 'primary'}`}
              onClick={handleStartSync}
              disabled={syncStatus === 'syncing'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '10px' }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              {syncStatus === 'completed' ? 'Rescan History' : 'Run Deep Scan'}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {isInitialState ? (
          <motion.div 
            className="analytics-empty-state"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <div className="empty-visual">🔍</div>
            <h3>No Analytics Data Found</h3>
            <p>Run a Deep Scan to pull your entire transaction history from the Movement network and calculate your lifetime performance.</p>
            <button className="empty-scan-btn" onClick={handleStartSync}>Start Discovery</button>
          </motion.div>
        ) : (
          <motion.div 
            className="analytics-dashboard-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {/* Header Summary Section */}
            <div className="analytics-header-grid">
              <motion.div className="analytics-summary-card pnl">
                <div className="summary-label">Lifetime Performance</div>
                <div className="summary-main-val">
                  {analyticsData ? (analyticsData.totalPnL >= 0 ? '+' : '-') : ''}${Math.abs(analyticsData?.totalPnL || 0).toLocaleString()}
                </div>
                <div className="summary-sub-row">
                  <span className={`summary-badge ${analyticsData?.pnlPercent >= 0 ? 'positive' : 'negative'}`}>
                    {analyticsData?.pnlPercent >= 0 ? '+' : ''}{analyticsData?.pnlPercent || 0}%
                  </span>
                  <span className="summary-context">since first transaction</span>
                </div>
                <div className="card-decoration">
                  <svg viewBox="0 0 200 100" className="bg-chart-svg">
                    <path d="M0,80 Q50,70 100,40 T200,20 L200,100 L0,100 Z" fill="url(#cardGrad)" opacity="0.1" />
                  </svg>
                </div>
              </motion.div>

              <div className="analytics-stats-capsules">
                <div className="stat-capsule">
                  <div className="stat-cap-icon">📊</div>
                  <div className="stat-cap-info">
                    <span className="stat-cap-label">Total Volume</span>
                    <span className="stat-cap-val">${(analyticsData?.totalVolume || 0).toLocaleString()}</span>
                  </div>
                </div>
                <div className="stat-capsule">
                  <div className="stat-cap-icon">⛽</div>
                  <div className="stat-cap-info">
                    <span className="stat-cap-label">Gas Spent</span>
                    <span className="stat-cap-val">${(analyticsData?.totalGasUsd || 0).toFixed(2)}</span>
                  </div>
                </div>
                <div className="stat-capsule">
                  <div className="stat-cap-icon">🔄</div>
                  <div className="stat-cap-info">
                    <span className="stat-cap-label">Interactions</span>
                    <span className="stat-cap-val">{analyticsData?.interactionCount || 0}</span>
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
                        <button key={tf} className={`time-btn-v4 ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
                      ))}
                    </div>
                  </div>
                  <div className="big-chart-container">
                    <ResponsiveContainer width="100%" height={340}>
                      <AreaChart data={analyticsData?.pnlHistory || []}>
                        <defs>
                          <linearGradient id="mainPnlGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25}/>
                            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} minTickGap={30}/>
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={3} fillOpacity={1} fill="url(#mainPnlGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="analytics-grid-two">
                  <div className="analytics-card-v4">
                    <h3 className="card-title-v4">Smart Insights</h3>
                    <div className="insights-list-v4">
                      {analyticsData?.insights?.map((insight: any, i: number) => (
                        <div className={`insight-item-v4 ${insight.type}`} key={i}>
                          <div className="insight-top">
                            <span className="insight-icon-v4">{insight.icon}</span>
                            <span className="insight-title-v4">{insight.title}</span>
                          </div>
                          <p className="insight-desc-v4">{insight.desc}</p>
                        </div>
                      )) || <p className="empty-insights">Run scan to generate insights</p>}
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
                        <Pie data={analyticsData?.protocolUsage || []} innerRadius={70} outerRadius={90} paddingAngle={8} dataKey="value" stroke="none">
                          {(analyticsData?.protocolUsage || []).map((entry: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AnalyticsView;
