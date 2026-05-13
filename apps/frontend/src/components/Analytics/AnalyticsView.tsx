import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Legend
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
  const [activeTab, setActiveTab] = useState<'overview' | 'exchange'>('overview');

  const { profile, loading: profileLoading } = useProfile(walletAddress || null);
  const isVerified = true; 

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';
  const COLORS = ['#cda169', '#36c690', '#7b68ee', '#ff4b4b', '#ffa500', '#00ced1'];

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

  const isInitialState = !analyticsData && syncStatus === 'idle';

  return (
    <div className="analytics-page-v4">
      <AnimatePresence mode="wait">
        {isInitialState ? (
          <motion.div className="analytics-discovery-minimal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="discovery-center-box">
              <button className="minimal-scan-btn" onClick={handleStartSync}><span>Run Deep Scan</span></button>
              <p className="minimal-scan-hint">Calculate your lifetime capital flow on Movement</p>
            </div>
          </motion.div>
        ) : syncStatus === 'syncing' ? (
          <motion.div className="analytics-discovery-minimal" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="discovery-center-box">
              <div className="minimal-sync-spinner"></div>
              <p className="minimal-sync-status">Analysing your history... {syncProgress}%</p>
            </div>
          </motion.div>
        ) : syncStatus === 'error' ? (
          <motion.div className="analytics-discovery-minimal error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="discovery-center-box">
              <div className="error-visual">⚠️</div>
              <p className="minimal-sync-status error">Unable to connect to sync engine</p>
              <button className="mini-rescan-btn" onClick={handleStartSync}>Retry Connection</button>
            </div>
          </motion.div>
        ) : (
          <motion.div className="analytics-dashboard-content" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="analytics-mini-header">
              <div className="mini-title-group">
                <h3>Portfolio Intelligence</h3>
                <span>Updated just now</span>
              </div>
              <div className="analytics-tabs-v4">
                <button className={`tab-btn-v4 ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
                <button className={`tab-btn-v4 ${activeTab === 'exchange' ? 'active' : ''}`} onClick={() => setActiveTab('exchange')}>Exchange Usage</button>
              </div>
              <button className="mini-rescan-btn" onClick={handleStartSync}>Rescan</button>
            </div>

            {activeTab === 'overview' ? (
              <>
                <div className="analytics-header-grid">
                  <div className="analytics-summary-card pnl">
                    <div className="summary-label">Total Capital Flow</div>
                    <div className="summary-main-val">${Math.abs(analyticsData?.totalVolume || 0).toLocaleString()}</div>
                    <div className="summary-sub-row">
                      <span className="summary-badge positive">{analyticsData?.activeMonths || 0} Months</span>
                      <span className="summary-context">of activity</span>
                    </div>
                  </div>
                  <div className="analytics-stats-capsules">
                    <div className="stat-capsule"><div className="stat-cap-info"><span className="stat-cap-label">Inflow</span><span className="stat-cap-val positive">+${(analyticsData?.totalInflow || 0).toLocaleString()}</span></div></div>
                    <div className="stat-capsule"><div className="stat-cap-info"><span className="stat-cap-label">Outflow</span><span className="stat-cap-val negative">-${(analyticsData?.totalOutflow || 0).toLocaleString()}</span></div></div>
                    <div className="stat-capsule"><div className="stat-cap-info"><span className="stat-cap-label">Interactions</span><span className="stat-cap-val">{analyticsData?.interactionCount || 0}</span></div></div>
                  </div>
                </div>

                <div className="analytics-content-layout">
                  <div className="analytics-main-column">
                    <div className="analytics-card-v4 chart-card">
                      <div className="card-header-v4">
                        <h3 className="card-title-v4">Transaction History</h3>
                        <div className="time-selectors-v4">
                          {TIME_FRAMES.map(tf => (<button key={tf} className={`time-btn-v4 ${timeframe === tf ? 'active' : ''}`} onClick={() => { setTimeframe(tf); fetchAnalyticsData(tf); }}>{tf}</button>))}
                        </div>
                      </div>
                      <div className="big-chart-container">
                        <ResponsiveContainer width="100%" height={320}>
                          <AreaChart data={analyticsData?.activityHistory || []}>
                            <defs><linearGradient id="mainPnlGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient></defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} minTickGap={30} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                            <Tooltip contentStyle={{ background: '#1a1a1a', border: 'none', borderRadius: '12px' }} />
                            <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={3} fillOpacity={1} fill="url(#mainPnlGrad)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                  <div className="analytics-side-column">
                    <div className="analytics-card-v4 affinity-card">
                      <h3 className="card-title-v4">Protocols</h3>
                      <div className="affinity-visual">
                        <ResponsiveContainer width="100%" height={240}>
                          <PieChart>
                            <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: 'none', borderRadius: '12px' }} />
                            <Legend verticalAlign="bottom" height={36} iconType="circle" />
                            <Pie data={analyticsData?.protocolUsage || []} innerRadius={60} outerRadius={75} paddingAngle={8} dataKey="value" stroke="none" nameKey="name">
                              {(analyticsData?.protocolUsage || []).map((entry: any, index: number) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="analytics-card-v4 badges-card">
                  <div className="analytics-badges-grid">
                    <div className="badges-section">
                      <h3 className="section-label-v4">Top protocol/addresses interact with</h3>
                      <div className="badges-container-v4">
                        {(analyticsData?.topEntities || []).map((entity: any, i: number) => (
                          <div key={i} className="pill-badge-v4">
                            <div className="pill-icon-v4">{entity.name.includes('...') ? '👤' : '⚡'}</div>
                            <span className="pill-name-v4">{entity.name}</span>
                            <span className="pill-value-v4">${Math.abs(entity.value).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="badges-section">
                      <h3 className="section-label-v4">Top tokens in transactions</h3>
                      <div className="badges-container-v4">
                        {(analyticsData?.topTokens || []).map((token: any, i: number) => (
                          <div key={i} className="pill-badge-v4">
                            <div className="pill-icon-v4">💰</div>
                            <span className="pill-name-v4">{token.symbol}</span>
                            <span className="pill-value-v4">${Math.abs(token.value).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="exchange-usage-view">
                <div className="exchange-grid-v4">
                  {/* Deposits Column */}
                  <div className="exchange-column-v4">
                    <div className="analytics-card-v4">
                      <div className="exchange-header-v4">
                        <div className="header-info">
                          <span className="label">DEPOSITS</span>
                          <span className="value">${(analyticsData?.exchangeUsage?.deposits?.total || 0).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="mini-chart-v4">
                        <ResponsiveContainer width="100%" height={140}>
                          <AreaChart data={analyticsData?.exchangeUsage?.deposits?.history || []}>
                            <Area type="monotone" dataKey="value" stroke="#36c690" fill="rgba(54, 198, 144, 0.1)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="exchange-breakdown-v4">
                        <div className="donut-container">
                          <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                              <Pie data={analyticsData?.exchangeUsage?.deposits?.breakdown || []} innerRadius={50} outerRadius={65} dataKey="value" stroke="none">
                                {(analyticsData?.exchangeUsage?.deposits?.breakdown || []).map((_: any, index: number) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}
                              </Pie>
                              <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: 'none' }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="exchange-list-v4">
                          {(analyticsData?.exchangeUsage?.deposits?.breakdown || []).map((ex: any, i: number) => (
                            <div key={i} className="exchange-item-v4">
                              <span className="dot" style={{ backgroundColor: COLORS[i % COLORS.length] }}></span>
                              <span className="name">{ex.name}</span>
                              <span className="val">${ex.value.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Withdrawals Column */}
                  <div className="exchange-column-v4">
                    <div className="analytics-card-v4">
                      <div className="exchange-header-v4">
                        <div className="header-info">
                          <span className="label">WITHDRAWALS</span>
                          <span className="value">${(analyticsData?.exchangeUsage?.withdrawals?.total || 0).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="mini-chart-v4">
                        <ResponsiveContainer width="100%" height={140}>
                          <AreaChart data={analyticsData?.exchangeUsage?.withdrawals?.history || []}>
                            <Area type="monotone" dataKey="value" stroke="#7b68ee" fill="rgba(123, 104, 238, 0.1)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="exchange-breakdown-v4">
                        <div className="donut-container">
                          <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                              <Pie data={analyticsData?.exchangeUsage?.withdrawals?.breakdown || []} innerRadius={50} outerRadius={65} dataKey="value" stroke="none">
                                {(analyticsData?.exchangeUsage?.withdrawals?.breakdown || []).map((_: any, index: number) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}
                              </Pie>
                              <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: 'none' }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="exchange-list-v4">
                          {(analyticsData?.exchangeUsage?.withdrawals?.breakdown || []).map((ex: any, i: number) => (
                            <div key={i} className="exchange-item-v4">
                              <span className="dot" style={{ backgroundColor: COLORS[i % COLORS.length] }}></span>
                              <span className="name">{ex.name}</span>
                              <span className="val">${ex.value.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AnalyticsView;
