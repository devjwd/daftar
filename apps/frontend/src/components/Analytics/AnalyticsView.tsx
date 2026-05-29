import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../../hooks/useProfile';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { AnalyticsData } from '../../types/analytics.types';

// Components
import SyncStateOverlay from './SyncStateOverlay';
import AnalyticsOverview from './AnalyticsOverview';
import VisualizerTab from '../Dashboard/VisualizerTab';
import SubscriptionGate from '../SubscriptionGate';

// Styles
import './AnalyticsV5.css';

interface AnalyticsViewProps {
  walletAddress?: string;
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ walletAddress }) => {
  const navigate = useNavigate();
  const { connected, account, signMessage } = useWallet();
  const [timeframe, setTimeframe] = useState('All');
  const [bottomTimeframe, setBottomTimeframe] = useState('All');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'completed' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [bottomAnalyticsData, setBottomAnalyticsData] = useState<AnalyticsData | null>(null);

  const lastSyncStringRef = React.useRef<string | null>(null);
  const lastSyncChangeTimeRef = React.useRef<number>(0);

  const { profile, loading: profileLoading } = useProfile(walletAddress || null);
  const rawTier = profile?.subscription_tier || (profile?.is_verified ? 'pro' : 'free');
  const subscriptionTier = rawTier === 'lite' ? 'pro' : rawTier;
  const isPremium = subscriptionTier !== 'free';

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

  // Keep timeframes in refs so the polling interval callback is never stale
  const timeframeRef = useRef(timeframe);
  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);

  const bottomTimeframeRef = useRef(bottomTimeframe);
  useEffect(() => { bottomTimeframeRef.current = bottomTimeframe; }, [bottomTimeframe]);

  useEffect(() => {
    if (!walletAddress) return;

    let isMounted = true;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;
    let syncComplete = false;
    let failedPolls = 0;
    const MAX_FAILED_POLLS = 30; // 30 × 6s = 3 minutes

    const stopPolling = () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };

    const doFetchAnalytics = async () => {
      if (!isMounted) return;
      try {
        if (timeframeRef.current === bottomTimeframeRef.current) {
          const res = await fetch(`${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${timeframeRef.current}`);
          if (!res.ok) return;
          const data = await res.json();
          if (isMounted) {
            setAnalyticsData(data);
            setBottomAnalyticsData(data);
          }
        } else {
          const [resGlobal, resBottom] = await Promise.all([
            fetch(`${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${timeframeRef.current}`),
            fetch(`${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${bottomTimeframeRef.current}`)
          ]);
          if (resGlobal.ok && resBottom.ok) {
            const dataGlobal = await resGlobal.json();
            const dataBottom = await resBottom.json();
            if (isMounted) {
              setAnalyticsData(dataGlobal);
              setBottomAnalyticsData(dataBottom);
            }
          }
        }
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
          syncComplete = true;
          failedPolls = 0;
          setSyncStatus('completed');
          stopPolling();
          doFetchAnalytics();
        } else if (data.is_queued) {
          setSyncStatus('syncing');
          setSyncProgress(0);
        } else if (data.synced_transactions > 0 || data.last_sync_at) {
          setSyncStatus('syncing');
        } else {
          failedPolls++;
          if (failedPolls >= MAX_FAILED_POLLS) {
            stopPolling();
            setSyncStatus('error');
          }
        }
      } catch (err) {
        console.error('Status check error:', err);
        failedPolls++;
        if (failedPolls >= MAX_FAILED_POLLS) {
          stopPolling();
          setSyncStatus('error');
        }
      }
    };

    // 1. Immediately fetch whatever data exists
    doFetchAnalytics();

    // 2. Auto-trigger sync if premium (fire-and-forget)
    if (isPremium) {
      fetch(`${API_URL}/api/analytics/sync?wallet=${walletAddress}`).catch(() => {});
      setSyncStatus('syncing');
    }

    // 3. Start polling — check status each tick
    const doPoll = async () => {
      if (!isMounted || syncComplete) return;
      await doCheckStatus();
    };

    // Initial status check
    doPoll();

    // Set up polling every 6 seconds
    pollIntervalId = setInterval(doPoll, 6000);

    return () => {
      isMounted = false;
      stopPolling();
    };
  }, [walletAddress, isPremium, API_URL]);

  const fetchAnalyticsData = async (tf = timeframe) => {
    if (!walletAddress) return;
    try {
      const res = await fetch(`${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${tf}`);
      const data = await res.json();
      setAnalyticsData(data);
    } catch (err) {
      console.error('Fetch analytics error:', err);
    }
  };

  const fetchBottomAnalyticsData = async (tf = bottomTimeframe, startDate?: string, endDate?: string) => {
    if (!walletAddress) return;
    try {
      let url = `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${tf}`;
      if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
      if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;
      const res = await fetch(url);
      const data = await res.json();
      setBottomAnalyticsData(data);
    } catch (err) {
      console.error('Fetch bottom analytics error:', err);
    }
  };

  const handleStartSync = async () => {
    if (!walletAddress) return;
    setSyncStatus('syncing');
    setSyncProgress(0);
    lastSyncStringRef.current = null;
    lastSyncChangeTimeRef.current = Date.now(); // Start the timer
    try {
      let queryParams = `wallet=${walletAddress}`;

      const normalizedConnectedAddress = account?.address 
        ? (typeof account.address === "string" ? account.address : (account.address as any)?.toString?.())?.toLowerCase()
        : null;
        
      const isOwner = normalizedConnectedAddress && normalizedConnectedAddress === walletAddress.toLowerCase();

      if (isOwner && typeof signMessage === 'function') {
        const timestamp = new Date().toISOString();
        const message = `Sync transaction history for wallet ${walletAddress}\nTimestamp: ${timestamp}`;
        
        const signResult = await signMessage({
          message,
          nonce: timestamp
        });
        
        queryParams += `&message=${encodeURIComponent(message)}&signature=${encodeURIComponent(JSON.stringify(signResult))}`;
      }

      const res = await fetch(`${API_URL}/api/analytics/sync?${queryParams}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Sync trigger failed");
      }
    } catch (err: any) {
      setSyncStatus('error');
      console.error("Sync trigger error:", err);
      alert(err.message || "Failed to trigger sync");
    }
  };

  const handleOpenVisualizer = () => {
    if (walletAddress) {
      navigate(`/profile/${walletAddress}/visualizer`);
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

  if (!isPremium) {
    return (
      <div className="analytics-v5-container" style={{ padding: '40px 20px' }}>
        <SubscriptionGate
          feature="Portfolio Analytics"
          description="Unlock portfolio metrics, performance tracking, transaction filters, and full historical analytics."
          requiredTier="pro"
        />
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
            <div className="analytics-page-header">
              <div className="analytics-page-header-left">
                <h2>Portfolio Intelligence</h2>
                <div className="analytics-page-header-sub">
                  <p>Live from database</p>
                  {syncStatus === 'syncing' && (
                    <div className="analytics-sync-indicator">
                      <span className="analytics-sync-badge">
                        {syncProgress === 0 ? 'Queued in background...' : 'Syncing history...'}
                      </span>
                      <div className="analytics-sync-bar">
                        <div className="analytics-sync-bar-fill" style={{ width: `${syncProgress}%` }} />
                      </div>
                      <span className="analytics-sync-pct">{syncProgress}%</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button className="analytics-visualizer-btn" onClick={handleOpenVisualizer}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                  Launch Visualizer
                </button>
                <button className="analytics-rescan-btn" onClick={handleStartSync}>
                  Rescan Network
                </button>
              </div>
            </div>

            {analyticsData && bottomAnalyticsData && (
              <AnalyticsOverview
                data={analyticsData}
                bottomData={bottomAnalyticsData}
                timeframe={timeframe}
                setTimeframe={(tf) => {
                  setTimeframe(tf);
                  fetchAnalyticsData(tf);
                }}
                bottomTimeframe={bottomTimeframe}
                setBottomTimeframe={(tf, startDate, endDate) => {
                  setBottomTimeframe(tf);
                  fetchBottomAnalyticsData(tf, startDate, endDate);
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AnalyticsView;
