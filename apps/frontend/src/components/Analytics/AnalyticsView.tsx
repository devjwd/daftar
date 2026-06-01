import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../../hooks/useProfile';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { AnalyticsData } from '../../types/analytics.types';
import { resolveEffectiveTier, isPremiumTier } from '../../utils/subscription';
import { useAnalyticsSync } from '../../hooks/useAnalyticsSync';

import SyncStateOverlay from './SyncStateOverlay';
import AnalyticsOverview from './AnalyticsOverview';
import PlanGate from '../PlanGate';

import './AnalyticsV5.css';

interface AnalyticsViewProps {
  walletAddress?: string;
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ walletAddress }) => {
  const navigate = useNavigate();
  const { account, signMessage } = useWallet();
  const [timeframe, setTimeframe] = useState('All');
  const [bottomTimeframe, setBottomTimeframe] = useState('All');
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [bottomAnalyticsData, setBottomAnalyticsData] = useState<AnalyticsData | null>(null);

  const { profile, loading: profileLoading } = useProfile(walletAddress || null);
  const subscriptionTier = resolveEffectiveTier({
    subscription_tier: profile?.subscription_tier,
    subscription_expires_at: profile?.subscription_expires_at,
    is_verified: profile?.is_verified,
  });
  const isPremium = isPremiumTier(subscriptionTier);

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const bottomTimeframeRef = useRef(bottomTimeframe);
  useEffect(() => {
    bottomTimeframeRef.current = bottomTimeframe;
  }, [bottomTimeframe]);

  const getConnectedAddress = useCallback(() => {
    if (!account?.address) return null;
    return (
      typeof account.address === 'string'
        ? account.address
        : (account.address as { toString?: () => string })?.toString?.()
    )?.toLowerCase() || null;
  }, [account?.address]);

  const fetchAnalyticsData = useCallback(
    async (tf = timeframeRef.current, bottomTf = bottomTimeframeRef.current) => {
      if (!walletAddress) return;

      try {
        if (tf === bottomTf) {
          const res = await fetch(
            `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${encodeURIComponent(tf)}`
          );
          if (!res.ok) {
            if (res.status === 403) {
              setFetchError('Analytics require an active Pro subscription for this profile.');
              return;
            }
            throw new Error('Failed to load analytics');
          }
          const data = await res.json();
          setAnalyticsData(data);
          setBottomAnalyticsData(data);
          setFetchError(null);
        } else {
          const [resGlobal, resBottom] = await Promise.all([
            fetch(
              `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${encodeURIComponent(tf)}`
            ),
            fetch(
              `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${encodeURIComponent(bottomTf)}`
            ),
          ]);
          if (!resGlobal.ok || !resBottom.ok) {
            if (resGlobal.status === 403 || resBottom.status === 403) {
              setFetchError('Analytics require an active Pro subscription for this profile.');
              return;
            }
            throw new Error('Failed to load analytics');
          }
          const dataGlobal = await resGlobal.json();
          const dataBottom = await resBottom.json();
          setAnalyticsData(dataGlobal);
          setBottomAnalyticsData(dataBottom);
          setFetchError(null);
        }
      } catch (err) {
        console.error('Fetch analytics error:', err);
        setFetchError('Unable to load analytics right now.');
      }
    },
    [walletAddress, API_URL]
  );

  const {
    syncStatus,
    syncProgress,
    fetchError,
    setFetchError,
    handleStartSync
  } = useAnalyticsSync(
    walletAddress,
    isPremium,
    async () => {
      await fetchAnalyticsData(timeframeRef.current, bottomTimeframeRef.current);
    }
  );

  useEffect(() => {
    if (walletAddress && isPremium && syncStatus === 'completed') {
       fetchAnalyticsData(timeframeRef.current, bottomTimeframeRef.current);
    }
  }, [walletAddress, isPremium, fetchAnalyticsData]);

  const fetchBottomOnly = async (tf: string, startDate?: string, endDate?: string) => {
    if (!walletAddress) return;
    try {
      let url = `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${encodeURIComponent(tf)}`;
      if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
      if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setBottomAnalyticsData(data);
    } catch (err) {
      console.error('Fetch bottom analytics error:', err);
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
        <PlanGate
          feature="Portfolio Analytics"
          description="Unlock portfolio metrics, performance tracking, transaction filters, and full historical analytics."
          requiredTier="pro"
        />
      </div>
    );
  }

  const hasData = analyticsData !== null;
  const isInitialSyncing = syncStatus === 'syncing' && !hasData;

  return (
    <div className="analytics-v5-container">
      <AnimatePresence mode="wait">
        {isInitialSyncing ? (
          <SyncStateOverlay
            key="sync-overlay"
            status="syncing"
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
                        <div
                          className="analytics-sync-bar-fill"
                          style={{ width: `${syncProgress}%` }}
                        />
                      </div>
                      <span className="analytics-sync-pct">{syncProgress}%</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button type="button" className="analytics-visualizer-btn" onClick={handleOpenVisualizer}>
                  Launch Visualizer
                </button>
                <button type="button" className="analytics-rescan-btn" onClick={handleStartSync}>
                  Rescan Network
                </button>
              </div>
            </div>

            {fetchError && (
              <div className="analytics-error-banner" role="alert">
                {fetchError}
              </div>
            )}

            {analyticsData?.truncated && (
              <div className="analytics-truncation-banner" role="status">
                Showing the most recent {analyticsData.loadedTransactionCount?.toLocaleString()} of your
                transactions (limit {analyticsData.maxTransactionLimit?.toLocaleString()}). Totals may be
                understated for very active wallets.
              </div>
            )}

            {analyticsData && bottomAnalyticsData && (
              <AnalyticsOverview
                data={analyticsData}
                bottomData={bottomAnalyticsData}
                timeframe={timeframe}
                setTimeframe={(tf) => {
                  setTimeframe(tf);
                  void fetchAnalyticsData(tf, bottomTimeframe);
                }}
                bottomTimeframe={bottomTimeframe}
                setBottomTimeframe={(tf, startDate, endDate) => {
                  setBottomTimeframe(tf);
                  void fetchBottomOnly(tf, startDate, endDate);
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
