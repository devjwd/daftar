import React from 'react';
import { useNavigate } from 'react-router-dom';
import './UpgradeModal.css';

interface UpgradeModalProps {
  onClose: () => void;
}

const UpgradeModal: React.FC<UpgradeModalProps> = ({ onClose }) => {
  const navigate = useNavigate();

  return (
    <div className="upgrade-modal-overlay fade-in" onClick={onClose}>
      <div className="upgrade-modal fade-in-up" onClick={(e) => e.stopPropagation()}>
        <button className="upgrade-modal-close" onClick={onClose} aria-label="Close modal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="upgrade-modal-content">
          <div className="upgrade-modal-icon-container">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#cda169" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          
          <h2 className="upgrade-modal-title">Unlock Pro Analytics</h2>
          <p className="upgrade-modal-desc">
            Upgrade to Pro to unlock comprehensive portfolio intelligence, historical performance charts, dynamic transaction filtering, and exclusive early-access features.
          </p>

          <div className="upgrade-modal-features">
            <div className="upgrade-modal-feature">
              <span className="upgrade-modal-feature-check">✓</span>
              <span>Full PNL History (All Timeframes)</span>
            </div>
            <div className="upgrade-modal-feature">
              <span className="upgrade-modal-feature-check">✓</span>
              <span>Portfolio Analytics Dashboard</span>
            </div>
            <div className="upgrade-modal-feature">
              <span className="upgrade-modal-feature-check">✓</span>
              <span>Advanced Transaction Visualizer</span>
            </div>
          </div>

          <button 
            className="upgrade-modal-cta" 
            onClick={() => {
              onClose();
              navigate('/plans');
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            Get Pro Plan
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpgradeModal;
