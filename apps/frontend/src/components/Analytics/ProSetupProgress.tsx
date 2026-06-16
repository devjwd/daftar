import React from 'react';
import './ProSetupProgress.css';

interface ProSetupProgressProps {
  synced: number;
  total: number;
  onDashboardClick?: () => void;
}

const ProSetupProgress: React.FC<ProSetupProgressProps> = ({ synced, total, onDashboardClick }) => {
  const percent = total > 0 ? Math.min(100, Math.max(3, (synced / total) * 100)) : 15;

  return (
    <div className="pro-setup-progress-overlay fade-in-up">
      <div className="pro-setup-header">
        <div className="processing-orbit">
          <div className="processing-orbit-ring" />
          <div className="processing-orbit-ring processing-orbit-ring--2" />
          <div className="processing-orbit-core">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cda169" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
        </div>
        <h3 className="pro-setup-title">Setting Up Your Pro Account</h3>
        <p className="pro-setup-subtitle">Indexing your full on-chain history from the Movement Network</p>
      </div>

      <div style={{ marginTop: '24px' }}>
        <div className="pro-setup-bar-wrap">
          <div className="pro-setup-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="pro-setup-labels">
          <span>
            {total > 0
              ? `${synced.toLocaleString()} / ${total.toLocaleString()} transactions`
              : 'Fetching transaction count...'}
          </span>
          {total > 0 && (
            <span style={{ color: '#cda169' }}>
              {Math.round(percent)}%
            </span>
          )}
        </div>
      </div>

      <div className="pro-setup-steps">
        <div className="pro-setup-step">
          <div className="pro-setup-step-icon done">✓</div>
          <span>Payment verified on-chain</span>
        </div>
        <div className="pro-setup-step">
          <div className="pro-setup-step-icon done">✓</div>
          <span>Pro subscription activated</span>
        </div>
        <div className="pro-setup-step">
          <div className="pro-setup-step-icon active"></div>
          <span style={{ color: '#fff', fontWeight: 600 }}>Blockchain history being indexed</span>
        </div>
        <div className="pro-setup-step" style={{ opacity: 0.5 }}>
          <div className="pro-setup-step-icon pending"></div>
          <span>Analytics charts ready</span>
        </div>
      </div>

      <div className="pro-setup-info-grid">
        <div className="pro-setup-info-card">
          <div className="pro-setup-info-label">Status</div>
          <div className="pro-setup-info-value" style={{ color: '#36c690', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <span style={{ width: 6, height: 6, background: '#36c690', borderRadius: '50%', display: 'inline-block' }}></span> Active
          </div>
        </div>
        <div className="pro-setup-info-card">
          <div className="pro-setup-info-label">Duration</div>
          <div className="pro-setup-info-value">30d</div>
        </div>
        <div className="pro-setup-info-card">
          <div className="pro-setup-info-label">Auto-Finish</div>
          <div className="pro-setup-info-value">~3 min</div>
        </div>
      </div>

      {onDashboardClick && (
        <button
          onClick={onDashboardClick}
          style={{
            marginTop: '32px',
            background: 'linear-gradient(135deg, #e5be8a, #cda169)',
            color: '#0d0d0d',
            border: 'none',
            borderRadius: '10px',
            padding: '12px 24px',
            fontWeight: 800,
            cursor: 'pointer',
            width: '100%'
          }}
        >
          Explore Other Tabs →
        </button>
      )}
      
      <p style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)', marginTop: '16px' }}>
        Indexing continues in the background after you leave
      </p>
    </div>
  );
};

export default ProSetupProgress;
