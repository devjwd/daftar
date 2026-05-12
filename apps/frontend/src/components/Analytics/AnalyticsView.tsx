import React, { useState, useEffect, useMemo } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid 
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
  const isVerified = profile?.is_verified || false;

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
            // Progress increment logic
            setSyncProgress(prev => Math.min(prev + 2, 99));
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
    if (!walletAddress || !isVerified) return;
    setSyncStatus('syncing');
    setSyncProgress(0);
    try {
      await fetch(`${process.env.VITE_API_URL || ''}/api/analytics/sync?wallet=${walletAddress}`);
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

  // Restricted Access View
  if (!isVerified) {
    return (
      <div className="analytics-page-v4">
        <div className="analytics-restricted-simple">
          <p>Analytics is limited to verified users only.</p>
        </div>
      </div>
    );
  }

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
        ) : (
          <motion.div 
            className="analytics-dashboard-content"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Header Action Bar (Only shown when data is ready) */}
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
                  ${Math.abs(analyticsData?.cumulativeVolume || 0).toLocaleString(undefined, {maximumFractionDigits:0})}
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
                    <span className="stat-cap-label">Volume</span>
                    <span className="stat-cap-val">${(analyticsData?.totalVolume || 0).toLocaleString()}</span>
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
                        <button key={tf} className={`time-btn-v4 ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
                      ))}
                    </div>
                  </div>
                  <div className="big-chart-container">
                    <ResponsiveContainer width="100%" height={320}>
                      <AreaChart data={analyticsData?.activityHistory || []}>
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
              </div>

              {/* Side Column */}
              <div className="analytics-side-column">
                <div className="analytics-card-v4 affinity-card">
                  <h3 className="card-title-v4">Protocols</h3>
                  <div className="affinity-visual">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={analyticsData?.protocolUsage || []} innerRadius={60} outerRadius={75} paddingAngle={8} dataKey="value" stroke="none">
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
