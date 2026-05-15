import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ walletAddress }) => {
  const [timeframe, setTimeframe] = useState('All');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'completed' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'exchange'>('overview');

  const lastSyncStringRef = React.useRef<string | null>(null);
  const lastSyncChangeTimeRef = React.useRef<number>(0);

  const { profile, loading: profileLoading } = useProfile(walletAddress || null);
  const isVerified = profile?.is_verified ?? true; // Default true for public views, gated by profile data

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

  useEffect(() => {
    if (!walletAddress || !isVerified) return;

    // Instantly fetch analytics data from the database
    fetchAnalyticsData();

    let intervalId: ReturnType<typeof setInterval> | null = null;

    // Also check sync status to see if initial deep sync is still running
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/analytics/status?wallet=${walletAddress}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.total_transactions > 0) {
          const progress = Math.min(100, Math.round((data.synced_transactions / data.total_transactions) * 100));
          setSyncProgress(progress);
        }

        if (data.full_history_synced) {
          setSyncStatus('completed');
        } else {
          setSyncStatus('syncing');
          // If it's still syncing initially, poll data every 5s to show progress
          intervalId = setInterval(() => {
            fetchAnalyticsData();
            checkSyncCompletion(intervalId);
          }, 5000);
        }
      } catch (err) {
        console.error("Status check error:", err);
      }
    };
    checkStatus();

    // Proper cleanup: clear interval on unmount or dependency change
    return () => {
      if (intervalId) clearInterval(intervalId);
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
  // We keep the overlay visible until we have at least some activity history to render
  const hasData = analyticsData && analyticsData.activityHistory && analyticsData.activityHistory.length > 0;
  
  // Transition logic: stay in syncing state until we have real data to show
  const isInitialSyncing = (syncStatus === 'syncing' || syncStatus === 'idle') && !hasData;

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
                    onClick={() => setActiveTab('overview')}
                  >
                    Overview
                  </button>
                  <button
                    className={`tab-v5 ${activeTab === 'exchange' ? 'active' : ''}`}
                    onClick={() => setActiveTab('exchange')}
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
