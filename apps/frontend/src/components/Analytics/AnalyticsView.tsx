import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../../hooks/useProfile';
import { AnalyticsData } from '../../types/analytics.types';

// Components
import SyncStateOverlay from './SyncStateOverlay';
import AnalyticsOverview from './AnalyticsOverview';
import ExchangeUsageDashboard from './ExchangeUsageDashboard';

// Styles
import './AnalyticsV5.css';

interface AnalyticsViewProps {
  walletAddress?: string;
  initialSubTab?: string;
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ walletAddress, initialSubTab }) => {
  const navigate = useNavigate();
  const [timeframe, setTimeframe] = useState('All');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'completed' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'exchange'>(
    initialSubTab === 'exchange' ? 'exchange' : 'overview'
  );

  useEffect(() => {
    if (initialSubTab === 'exchange') setActiveTab('exchange');
    else setActiveTab('overview');
  }, [initialSubTab]);

  const lastSyncStringRef = React.useRef<string | null>(null);
  const lastSyncChangeTimeRef = React.useRef<number>(0);

  const { profile, loading: profileLoading } = useProfile(walletAddress || null);
  const isVerified = profile?.is_verified ?? true; // Default true for public views, gated by profile data

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

  useEffect(() => {
    if (!walletAddress) return;

    let isMounted = true;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };

    const doFetchAnalytics = async (tf = timeframe) => {
      if (!isMounted) return;
      try {
        const res = await fetch(`${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${tf}`);
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted) setAnalyticsData(data);
      } catch (err) {
        console.error('Fetch analytics error:', err);
      }
    };

    const doCheckStatus = async () => {
      if (!isMounted) return;
      try {
        const res = await fetch(`${API_URL}/api/analytics/status?wallet=${walletAddress}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        if (data.total_transactions > 0) {
          const progress = Math.min(100, Math.round((data.synced_transactions / data.total_transactions) * 100));
          setSyncProgress(progress);
        }

        if (data.full_history_synced) {
          setSyncStatus('completed');
          stopPolling();
          doFetchAnalytics();
        } else if (data.synced_transactions > 0 || data.last_sync_at) {
          // A sync has run — keep showing data even if not 100%
          setSyncStatus('syncing');
        }
      } catch (err) {
        console.error('Status check error:', err);
      }
    };

    // 1. Immediately fetch whatever data exists
    doFetchAnalytics();

    // 2. Check current sync status
    doCheckStatus().then(() => {
      if (!isMounted) return;
      // 3. Poll every 6 seconds to update progress and data
      pollIntervalId = setInterval(async () => {
        await doFetchAnalytics();
        await doCheckStatus();
      }, 6000);
    });

    // 4. Auto-trigger sync if not verified-only gated (for first-time users)
    // Fire-and-forget so it doesn't block the UI
    if (isVerified) {
      fetch(`${API_URL}/api/analytics/sync?wallet=${walletAddress}`).catch(() => {});
      setSyncStatus('syncing');
    }

    return () => {
      isMounted = false;
      stopPolling();
    };
  }, [walletAddress, isVerified, API_URL]);

  const checkSyncCompletion = async (interval: any) => {
    try {
      const res = await fetch(`${API_URL}/api/analytics/status?wallet=${walletAddress}`);
      const data = await res.json();

      if (data.total_transactions > 0) {
        const progress = Math.min(100, Math.round((data.synced_transactions / data.total_transactions) * 100));
        setSyncProgress(progress);
      }

      if (data.full_history_synced) {
        setSyncStatus('completed');
        clearInterval(interval);
        fetchAnalyticsData(); // Final fetch
      }
    } catch (e) { }
  };

  const fetchAnalyticsData = async (tf = timeframe) => {
    if (!walletAddress) return;

    try {
      const res = await fetch(`${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${tf}`);
      const data = await res.json();
      setAnalyticsData(data);
    } catch (err) {
      console.error("Fetch analytics error:", err);
    }
  };

  const handleStartSync = async () => {
    if (!walletAddress || !isVerified) return;
    setSyncStatus('syncing');
    setSyncProgress(0);
    lastSyncStringRef.current = null;
    lastSyncChangeTimeRef.current = Date.now(); // Start the timer
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
      <div style={{ display: 'flex', justifyContent: 'center', padding: '100px' }}>
        <div className="radar-pulse-container">
          <div className="radar-pulse"></div>
        </div>
      </div>
    );
  }

  // If we have data and it's not totally empty, show dashboard
  // Only show the full-page overlay if we have received NO response from the server at all
  const hasData = analyticsData !== null;
  const hasActivity = analyticsData?.activityHistory && analyticsData.activityHistory.length > 0;
  
  // Show overlay only while first sync is actively running and we've never gotten any server data
  const isInitialSyncing = syncStatus === 'syncing' && !hasData;

  return (
    <div className="analytics-v5-container">
      <AnimatePresence mode="wait">
        {isInitialSyncing ? (
          <SyncStateOverlay
            key="sync-overlay"
            status={'syncing'}
            progress={syncProgress}
            onStartSync={handleStartSync}
          />
        ) : (
          <motion.div
            key="dashboard-content"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h2 style={{ fontSize: '24px', fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>Portfolio Intelligence</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <p style={{ color: 'var(--text-tertiary)', fontSize: '14px' }}>Live from database</p>
                  {syncStatus === 'syncing' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', background: 'rgba(205,161,105,0.1)', color: 'var(--primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                        Syncing history...
                      </span>
                      <div style={{ width: '80px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${syncProgress}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.4s ease' }}></div>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>{syncProgress}%</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div className="tabs-container-v5" style={{ margin: 0 }}>
                  <button
                    className={`tab-v5 ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => {
                      if (!walletAddress) return;
                      setActiveTab('overview');
                      navigate(`/profile/${walletAddress}/analytics/overview`);
                    }}
                  >
                    Overview
                  </button>
                  <button
                    className={`tab-v5 ${activeTab === 'exchange' ? 'active' : ''}`}
                    onClick={() => {
                      if (!walletAddress) return;
                      setActiveTab('exchange');
                      navigate(`/profile/${walletAddress}/analytics/exchange`);
                    }}
                  >
                    Exchange Flows
                  </button>
                </div>

                <button
                  onClick={handleStartSync}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', padding: '10px 20px', borderRadius: '100px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                >
                  Rescan Network
                </button>
              </div>
            </div>

            {analyticsData && (
              activeTab === 'overview' ? (
                <AnalyticsOverview
                  data={analyticsData}
                  timeframe={timeframe}
                  setTimeframe={(tf) => {
                    setTimeframe(tf);
                    fetchAnalyticsData(tf);
                  }}
                />
              ) : (
                <ExchangeUsageDashboard data={analyticsData} />
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AnalyticsView;
