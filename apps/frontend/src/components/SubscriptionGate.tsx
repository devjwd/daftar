import React from 'react';
import { useNavigate } from 'react-router-dom';
import './SubscriptionGate.css';

interface SubscriptionGateProps {
  feature: string;
  description?: string;
  requiredTier?: 'lite' | 'pro';
}

/**
 * SubscriptionGate — Overlay shown when a user tries to access a premium feature
 * without the required subscription tier. Redirects to the pricing page.
 */
const SubscriptionGate: React.FC<SubscriptionGateProps> = ({
  feature,
  description,
  requiredTier = 'lite',
}) => {
  const navigate = useNavigate();

  const tierLabel = requiredTier === 'pro' ? 'Pro' : 'Lite';
  const tierPrice = requiredTier === 'pro' ? '$5' : '$2';

  const defaultDescription = `${feature} is available on the ${tierLabel} plan and above. Upgrade for just ${tierPrice}/month to unlock this and more premium features.`;

  return (
    <div className="subscription-gate-overlay">
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
        onClick={() => navigate('/pricing')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" />
        </svg>
        View Plans — {tierPrice}/mo
      </button>

      <div className="gate-feature-list">
        {requiredTier === 'lite' && (
          <>
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
          </>
        )}
        {requiredTier === 'pro' && (
          <>
            <span className="gate-feature-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              All Lite Features
            </span>
            <span className="gate-feature-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Priority Support
            </span>
            <span className="gate-feature-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Early Features
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default SubscriptionGate;
