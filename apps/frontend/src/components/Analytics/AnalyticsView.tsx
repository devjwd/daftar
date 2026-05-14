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
  const [timeframe, setTimeframe] = useState('1M');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'completed' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'exchange'>('overview');

  const lastSyncStringRef = React.useRef<string | null>(null);
  const lastSyncChangeTimeRef = React.useRef<number>(0);

  const { profile, loading: profileLoading } = useProfile(walletAddress || null);
  const isVerified = true; 

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

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
          } else if (data.last_sync_at) {
            if (data.last_sync_at !== lastSyncStringRef.current) {
              lastSyncStringRef.current = data.last_sync_at;
              lastSyncChangeTimeRef.current = Date.now();
            } else if (lastSyncChangeTimeRef.current > 0) {
              if (Date.now() - lastSyncChangeTimeRef.current > 2 * 60 * 1000) {
                console.error("Sync timed out (stuck for > 2 mins client time)");
                setSyncStatus('error');
                clearInterval(interval);
                return;
              }
            }
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

  const isInitialState = !analyticsData && syncStatus === 'idle';

  return (
    <div className="analytics-v5-container">
      <AnimatePresence mode="wait">
        {isInitialState || syncStatus === 'syncing' || syncStatus === 'error' ? (
          <SyncStateOverlay 
            key="sync-overlay"
            status={syncStatus} 
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
                <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginTop: '4px' }}>Real-time analytics engine</p>
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
