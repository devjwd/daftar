import React from 'react';
import { useNavigate } from 'react-router-dom';
import './PlanGate.css';

interface PlanGateProps {
  feature: string;
  description?: string;
  requiredTier?: 'pro';
}

/**
 * PlanGate — Overlay shown when a user tries to access a premium feature
 * without the required plan tier. Redirects to the plans page.
 */
const PlanGate: React.FC<PlanGateProps> = ({
  feature,
  description,
  requiredTier = 'pro',
}) => {
  const navigate = useNavigate();

  const tierLabel = 'Pro';
  const tierPrice = '$5';

  const defaultDescription = `${feature} is available on the ${tierLabel} plan. Upgrade for just ${tierPrice}/month to unlock this and more premium features.`;

  return (
    <div className="plan-gate-overlay">
      <div className="gate-icon-wrapper">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <h3 className="gate-title">Upgrade to {tierLabel}</h3>
      <p className="gate-description">
        {description || defaultDescription}
      </p>

      <button
        className="gate-cta-btn"
        onClick={() => navigate('/plans')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" />
        </svg>
        View Plans — {tierPrice}/mo
      </button>

      <div className="gate-feature-list">
        <span className="gate-feature-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          PNL History
        </span>
        <span className="gate-feature-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          Analytics
        </span>
        <span className="gate-feature-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          Visualizer
        </span>
        <span className="gate-feature-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          Priority Support
        </span>
      </div>
    </div>
  );
};

export default PlanGate;
