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

// Skeleton placeholder for analytics sections
const AnalyticsSkeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
    {/* Stats row skeleton */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{
            width: '60%',
            height: '10px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '4px',
            marginBottom: '12px',
          }} />
          <div style={{
            width: '40%',
            height: '24px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '6px',
          }} />
        </div>
      ))}
    </div>
    {/* Chart skeleton */}
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid rgba(255,255,255,0.05)',
      height: '280px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, rgba(205,161,105,0.04) 0%, transparent 100%)',
        borderRadius: '12px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, transparent 0%, rgba(205,161,105,0.05) 50%, transparent 100%)',
          }}
        />
      </div>
    </div>
    {/* Bottom sections skeleton */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
      {[1, 2].map(i => (
        <div key={i} style={{
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid rgba(255,255,255,0.05)',
          height: '200px',
        }}>
          <div style={{
            width: '50%',
            height: '12px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '4px',
            marginBottom: '16px',
          }} />
          {[1, 2, 3].map(j => (
            <div key={j} style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '12px',
            }}>
              <div style={{ width: '30%', height: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }} />
              <div style={{ width: '20%', height: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ walletAddress }) => {
  const navigate = useNavigate();
  const { account, signMessage } = useWallet();
  const [timeframe, setTimeframe] = useState('All');
  const [bottomTimeframe, setBottomTimeframe] = useState('All');
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [bottomAnalyticsData, setBottomAnalyticsData] = useState<AnalyticsData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

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

      const cacheKeyGlobal = `analytics_cache_${walletAddress.toLowerCase()}_${tf}`;
      const cacheKeyBottom = `analytics_cache_${walletAddress.toLowerCase()}_${bottomTf}`;

      // 1. Try to load Stale (cached) data first for 0ms page load
      try {
        const cachedGlobal = localStorage.getItem(cacheKeyGlobal);
        const cachedBottom = localStorage.getItem(cacheKeyBottom);
        if (cachedGlobal && cachedBottom) {
          setAnalyticsData(JSON.parse(cachedGlobal));
          setBottomAnalyticsData(JSON.parse(cachedBottom));
        } else if (cachedGlobal) {
          setAnalyticsData(JSON.parse(cachedGlobal));
          setBottomAnalyticsData(JSON.parse(cachedGlobal));
        }
      } catch (cacheErr) {
        console.warn('Failed to parse browser analytics cache:', cacheErr);
      }

      setDataLoading(true);
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

          // Save to browser cache
          try {
            localStorage.setItem(cacheKeyGlobal, JSON.stringify(data));
            localStorage.setItem(cacheKeyBottom, JSON.stringify(data));
          } catch {}
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

          // Save to browser cache
          try {
            localStorage.setItem(cacheKeyGlobal, JSON.stringify(dataGlobal));
            localStorage.setItem(cacheKeyBottom, JSON.stringify(dataBottom));
          } catch {}
        }

        // Clean up old cached items for other wallets to prevent quota exceeded errors
        try {
          const currentWalletPrefix = `analytics_cache_${walletAddress.toLowerCase()}_`;
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('analytics_cache_') && !key.startsWith(currentWalletPrefix)) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(key => localStorage.removeItem(key));
        } catch {}
      } catch (err) {
        console.error('Fetch analytics error:', err);
        setFetchError('Unable to load analytics right now.');
      } finally {
        setDataLoading(false);
      }
    },
    [walletAddress, API_URL]
  );

  const handleSyncComplete = useCallback(async () => {
    await fetchAnalyticsData(timeframeRef.current, bottomTimeframeRef.current);
  }, [fetchAnalyticsData]);

  const {
    syncStatus,
    syncProgress,
    fetchError,
    setFetchError,
    handleStartSync
  } = useAnalyticsSync(
    walletAddress,
    isPremium,
    handleSyncComplete
  );

  // Fetch data as soon as we know the user is premium, even if sync isn't complete yet
  useEffect(() => {
    if (walletAddress && isPremium && (syncStatus === 'completed' || syncStatus === 'syncing')) {
       fetchAnalyticsData(timeframeRef.current, bottomTimeframeRef.current);
    }
  }, [walletAddress, isPremium, syncStatus === 'completed']); // Only re-trigger on completed transition

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
      <div className="analytics-v5-container" style={{ padding: '40px 20px' }}>
        <AnalyticsSkeleton />
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
  const isInitialSyncing = syncStatus === 'syncing' && !hasData && !dataLoading;
  const showSyncBanner = syncStatus === 'syncing' && hasData;

  return (
    <div className="analytics-v5-container">
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

        {/* Inline sync banner (non-blocking) */}
        <AnimatePresence>
          {(syncStatus === 'syncing' || syncStatus === 'error' || (syncStatus === 'idle' && !hasData && !dataLoading)) && (
            <SyncStateOverlay
              status={syncStatus === 'idle' && !hasData ? 'idle' : syncStatus as any}
              progress={syncProgress}
              onStartSync={handleStartSync}
            />
          )}
        </AnimatePresence>

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

        {/* Show data or skeleton */}
        {analyticsData && bottomAnalyticsData ? (
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
        ) : (
          // Show skeleton while loading data (not blocking full screen)
          hasData === false && syncStatus !== 'idle' && <AnalyticsSkeleton />
        )}
      </motion.div>
    </div>
  );
};

export default AnalyticsView;
