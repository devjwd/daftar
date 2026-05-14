import React from 'react';
import { motion } from 'framer-motion';
import { Radar, AlertTriangle, ScanSearch } from 'lucide-react';

interface SyncStateOverlayProps {
  status: 'idle' | 'syncing' | 'error';
  progress: number;
  onStartSync: () => void;
}

const SyncStateOverlay: React.FC<SyncStateOverlayProps> = ({ status, progress, onStartSync }) => {
  return (
    <motion.div 
      className="bento-card sync-overlay-v5"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
    >
      {status === 'idle' && (
        <>
          <div className="radar-pulse-container">
            <ScanSearch size={48} className="radar-icon" strokeWidth={1.5} />
          </div>
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>Uncover Your On-Chain Identity</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '15px', maxWidth: '400px' }}>
              Run a deep scan of the Movement network to compile your complete transaction history, PNL, and protocol affinity.
            </p>
          </div>
          <button className="btn-glowing-v5" onClick={onStartSync}>
            <Radar size={20} />
            <span>Initiate Deep Scan</span>
          </button>
        </>
      )}

      {status === 'syncing' && (
        <>
          <div className="radar-pulse-container">
            <div className="radar-pulse"></div>
            <Radar size={48} className="radar-icon" strokeWidth={1.5} />
          </div>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>Extracting Data...</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '15px' }}>
              Analyzing history and computing metrics.
            </p>
          </div>
          <div style={{ width: '200px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.3s ease' }}></div>
          </div>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="radar-pulse-container" style={{ background: 'rgba(255, 75, 75, 0.1)', borderRadius: '50%' }}>
            <AlertTriangle size={48} color="#ff4b4b" strokeWidth={1.5} />
          </div>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>Connection Lost</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '15px' }}>
              The indexer failed to respond in time. Please try again.
            </p>
          </div>
          <button className="btn-glowing-v5" style={{ background: '#ff4b4b', boxShadow: '0 0 20px rgba(255, 75, 75, 0.2)' }} onClick={onStartSync}>
            Retry Scan
          </button>
        </>
      )}
    </motion.div>
  );
};

export default SyncStateOverlay;
