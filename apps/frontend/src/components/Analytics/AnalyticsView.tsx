import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, Legend
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { useProfile } from '../../hooks/useProfile';
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

  // Fetch profile to check verification status
  const { profile, loading: profileLoading } = useProfile(walletAddress || null);
  // Using a safe check to satisfy TypeScript - FORCED TO TRUE FOR TESTING
  const isVerified = true; // (profile as any)?.is_verified || false;

  // Vite uses import.meta.env instead of process.env
  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

  // Poll sync status if syncing
  useEffect(() => {
    let interval: any;
    if (syncStatus === 'syncing' && walletAddress) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/analytics/status?wallet=${walletAddress}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json();
          if (data.full_history_synced) {
            setSyncStatus('completed');
            fetchAnalyticsData();
            clearInterval(interval);
          }
          if (data.last_synced_version) {
            setSyncProgress(prev => Math.min(prev + 2, 99));
          }
        } catch (err) {
          console.error("Status polling error:", err);
          setSyncStatus('error');
          clearInterval(interval);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [syncStatus, walletAddress, API_URL]);

  const fetchAnalyticsData = async (tf = timeframe) => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      // Security: Sign a simple message to verify ownership
      const message = `View analytics for ${walletAddress} at ${new Date().toISOString().split('T')[0]}`;
      // In a real app, we'd trigger a wallet sign here, but for now we'll pass it if we have it
      // or just ensure the timeframe is sent.
      const res = await fetch(`${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${tf}`);
      const data = await res.json();
      setAnalyticsData(data);
    } catch (err) {
      console.error("Fetch analytics error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSync = async () => {
    if (!walletAddress || !isVerified) return;
    setSyncStatus('syncing');
    setSyncProgress(0);
    try {
      const res = await fetch(`${API_URL}/api/analytics/sync?wallet=${walletAddress}`);
      if (!res.ok) throw new Error("Sync trigger failed");
    } catch (err) {
      setSyncStatus('error');
      console.error("Sync trigger error:", err);
    }
  };

  if (profileLoading) {
    return (
      <div className="analytics-loading">
        <div className="sync-spinner large"></div>
      </div>
    );
  }

  // Restricted Access View - DISABLED FOR TESTING
  /*
  if (!isVerified) {
    return (
      <div className="analytics-page-v4">
        <div className="analytics-restricted-simple">
          <p>Analytics is limited to verified users only.</p>
        </div>
      </div>
    );
  }
  */

  // If no data and not syncing, show the Minimalist Discovery state
  const isInitialState = !analyticsData && syncStatus === 'idle';

  return (
    <div className="analytics-page-v4">
      <AnimatePresence mode="wait">
        {isInitialState ? (
          <motion.div
            className="analytics-discovery-minimal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="discovery-center-box">
              <button className="minimal-scan-btn" onClick={handleStartSync}>
                <span>Run Deep Scan</span>
              </button>
              <p className="minimal-scan-hint">Calculate your lifetime capital flow on Movement</p>
            </div>
          </motion.div>
        ) : syncStatus === 'syncing' ? (
          <motion.div
            className="analytics-discovery-minimal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="discovery-center-box">
              <div className="minimal-sync-spinner"></div>
              <p className="minimal-sync-status">Analysing your history... {syncProgress}%</p>
            </div>
          </motion.div>
        ) : syncStatus === 'error' ? (
          <motion.div
            className="analytics-discovery-minimal error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="discovery-center-box">
              <div className="error-visual">⚠️</div>
              <p className="minimal-sync-status error">Unable to connect to sync engine</p>
              <button className="mini-rescan-btn" onClick={handleStartSync}>Retry Connection</button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            className="analytics-dashboard-content"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Header Action Bar */}
            <div className="analytics-mini-header">
              <div className="mini-title-group">
                <h3>Portfolio Intelligence</h3>
                <span>Updated just now</span>
              </div>
              <button className="mini-rescan-btn" onClick={handleStartSync}>Rescan</button>
            </div>

            {/* Header Summary Section */}
            <div className="analytics-header-grid">
              <motion.div className="analytics-summary-card pnl">
                <div className="summary-label">Total Capital Flow</div>
                <div className="summary-main-val">
                  ${Math.abs(analyticsData?.cumulativeVolume || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="summary-sub-row">
                  <span className="summary-badge positive">
                    {analyticsData?.activeMonths || 0} Months
                  </span>
                  <span className="summary-context">of activity</span>
                </div>
              </motion.div>

              <div className="analytics-stats-capsules">
                <div className="stat-capsule">
                  <div className="stat-cap-info">
                    <span className="stat-cap-label">Avg TX</span>
                    <span className="stat-cap-val">
                      ${analyticsData?.interactionCount > 0 
                        ? (analyticsData?.totalVolume / analyticsData?.interactionCount).toLocaleString(undefined, {maximumFractionDigits: 0}) 
                        : '0'}
                    </span>
                  </div>
                </div>
                <div className="stat-capsule">
                  <div className="stat-cap-info">
                    <span className="stat-cap-label">Gas</span>
                    <span className="stat-cap-val">${(analyticsData?.totalGasUsd || 0).toFixed(2)}</span>
                  </div>
                </div>
                <div className="stat-capsule">
                  <div className="stat-cap-info">
                    <span className="stat-cap-label">Inflow</span>
                    <span className="stat-cap-val positive">
                      +${(analyticsData?.totalInflow || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
                <div className="stat-capsule">
                  <div className="stat-cap-info">
                    <span className="stat-cap-label">Outflow</span>
                    <span className="stat-cap-val negative">
                      -${(analyticsData?.totalOutflow || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
                <div className="stat-capsule">
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
                    <h3 className="card-title-v4">Activity History</h3>
                    <div className="time-selectors-v4">
                      {TIME_FRAMES.map(tf => (
                        <button 
                          key={tf} 
                          className={`time-btn-v4 ${timeframe === tf ? 'active' : ''}`} 
                          onClick={() => {
                            setTimeframe(tf);
                            fetchAnalyticsData(tf);
                          }}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="big-chart-container">
                    <ResponsiveContainer width="100%" height={320}>
                      <AreaChart data={analyticsData?.activityHistory || []}>
                        <defs>
                          <linearGradient id="mainPnlGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} minTickGap={30} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={3} fillOpacity={1} fill="url(#mainPnlGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Side Column */}
              <div className="analytics-side-column">
                <div className="analytics-card-v4 affinity-card">
                  <h3 className="card-title-v4">Protocols</h3>
                  <div className="affinity-visual">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Tooltip contentStyle={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }} itemStyle={{ color: 'var(--text-primary)' }} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                        <Pie data={analyticsData?.protocolUsage || []} innerRadius={60} outerRadius={75} paddingAngle={8} dataKey="value" stroke="none" nameKey="name">
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
            
            {/* New Badges Section */}
            <div className="analytics-badges-grid">
              {/* Top Protocols/Addresses */}
              <div className="badges-section">
                <h3>Top protocol/addresses interact with</h3>
                <div className="badges-container">
                  {(analyticsData?.topEntities || []).map((entity: any, i: number) => (
                    <div key={i} className="badge-capsule">
                      <div className="badge-icon">
                        {entity.name.includes('...') ? '👤' : '⚡'}
                      </div>
                      <span className="badge-name">{entity.name}</span>
                      <span className="badge-value">${Math.abs(entity.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Tokens */}
              <div className="badges-section">
                <h3>Top tokens in transactions</h3>
                <div className="badges-container">
                  {(analyticsData?.topTokens || []).map((token: any, i: number) => (
                    <div key={i} className="badge-capsule">
                      <div className="badge-icon">💎</div>
                      <span className="badge-name">{token.symbol}</span>
                      <span className="badge-value">${Math.abs(token.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  ))}
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
