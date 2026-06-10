import React from 'react';
import { motion } from 'framer-motion';
import { Radio, Hourglass, RefreshCw, AlertTriangle } from 'lucide-react';

interface SyncStateOverlayProps {
  status: 'idle' | 'queued' | 'syncing' | 'error';
  progress: number;
  onStartSync: () => void;
}

const SyncStateOverlay: React.FC<SyncStateOverlayProps> = ({ status, progress, onStartSync }) => {
  // Idle state: show a minimal call-to-action card
  if (status === 'idle') {
    return (
      <motion.div
        className="analytics-sync-inline-card"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(205,161,105,0.15)',
          borderRadius: '16px',
          padding: '32px',
          textAlign: 'center',
          maxWidth: '480px',
          margin: '40px auto',
        }}
      >
        <div style={{ marginBottom: '12px', color: 'var(--primary)' }}>
          <Radio size={36} />
        </div>
        <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
          Start Data Sync
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', margin: '0 0 20px', lineHeight: 1.5 }}>
          Pull your full transaction history from the Movement indexer to unlock analytics.
        </p>
        <button
          className="analytics-rescan-btn"
          onClick={onStartSync}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 24px',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          Initiate Scan
        </button>
      </motion.div>
    );
  }

  // Queued state: show a minimal inline card indicating it's waiting in queue
  if (status === 'queued') {
    return (
      <motion.div
        className="analytics-sync-inline-card"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '20px',
        }}
      >
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Hourglass size={16} />
          </motion.div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
              Sync request queued...
            </span>
          </div>
          <div style={{
            width: '100%',
            height: '4px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '100px',
            overflow: 'hidden',
          }}>
            <motion.div
              animate={{ x: [-200, 300] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
              style={{
                width: '100px',
                height: '100%',
                background: 'linear-gradient(90deg, transparent, rgba(205,161,105,0.4), transparent)',
              }}
            />
          </div>
        </div>
      </motion.div>
    );
  }

  // Syncing state: show a minimal inline progress bar
  if (status === 'syncing') {
    return (
      <motion.div
        className="analytics-sync-inline-card"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        style={{
          background: 'rgba(205,161,105,0.04)',
          border: '1px solid rgba(205,161,105,0.12)',
          borderRadius: '12px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '20px',
        }}
      >
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: 'rgba(205,161,105,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <RefreshCw size={16} />
          </motion.div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>
              {progress === 0 ? 'Scanning network...' : progress < 100 ? 'Syncing history...' : 'Finalizing...'}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }}>
              {progress > 0 ? `${progress}%` : ''}
            </span>
          </div>
          <div style={{
            width: '100%',
            height: '4px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '100px',
            overflow: 'hidden',
          }}>
            {progress > 0 ? (
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #cda169, #ffcc8d)',
                  borderRadius: '100px',
                }}
              />
            ) : (
              <motion.div
                animate={{ x: [-200, 300] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                style={{
                  width: '100px',
                  height: '100%',
                  background: 'linear-gradient(90deg, transparent, #cda169, transparent)',
                }}
              />
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Error state: minimal error banner
  if (status === 'error') {
    return (
      <motion.div
        className="analytics-sync-inline-card"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        style={{
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.15)',
          borderRadius: '12px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '20px',
        }}
      >
        <AlertTriangle size={20} color="#fca5a5" />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#fca5a5' }}>
            Sync failed. The indexer may be temporarily unavailable.
          </span>
        </div>
        <button
          className="analytics-rescan-btn"
          onClick={onStartSync}
          style={{ fontSize: '12px', padding: '6px 16px' }}
        >
          Retry
        </button>
      </motion.div>
    );
  }

  return null;
};

export default SyncStateOverlay;
