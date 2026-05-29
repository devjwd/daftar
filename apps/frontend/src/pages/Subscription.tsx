import React, { useEffect, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useProfile } from '../hooks/useProfile';
import { getSubscriptionPlans } from '../services/api';
import './Subscription.css';

interface PlanDefinition {
  id: 'free' | 'pro';
  name: string;
  price: number;
  interval: string | null;
  features: string[];
  limits: {
    pnlHistory: boolean;
    analytics: boolean;
    visualizer: boolean;
    prioritySupport: boolean;
    earlyFeatures: boolean;
  };
}

export default function Subscription() {
  const { account, connected } = useWallet();
  const walletAddress = connected && account?.address ? String(account.address) : null;
  const { profile, loading: profileLoading } = useProfile(walletAddress);
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  // Derive current tier (Map legacy 'lite' to 'pro' for fallback/current plan highlight)
  const rawTier = profile?.subscription_tier || (profile?.is_verified ? 'pro' : 'free');
  const currentTier = rawTier === 'lite' ? 'pro' : rawTier;

  useEffect(() => {
    async function loadPlans() {
      try {
        const fetchedPlans = await getSubscriptionPlans();
        if (fetchedPlans && fetchedPlans.length > 0) {
          // Filter out legacy plans if returned by server
          const filtered = fetchedPlans.filter((p: any) => p.id !== 'lite');
          setPlans(filtered);
        }
      } catch (err) {
        console.error('Failed to load plans:', err);
      } finally {
        setLoadingPlans(false);
      }
    }
    loadPlans();
  }, []);

  const handleCtaClick = (planId: 'free' | 'pro') => {
    if (planId === currentTier) return;
    
    // Prompt manual subscription admin flow instructions
    alert(
      `To upgrade or modify your subscription to the ${planId.toUpperCase()} plan, please reach out to the Daftar Administrator on Telegram (@daftarfi) or Discord. Make sure to provide your wallet address: \n\n${walletAddress || 'Your wallet address'}`
    );
  };

  // Fallback plans if API fails
  const displayPlans = plans.length > 0 ? plans : [
    {
      id: 'free' as const,
      name: 'Free',
      price: 0,
      interval: null,
      features: [
        'Portfolio Tracker',
        'Transaction History',
        'NFT Gallery',
        '24h PNL Overview',
      ],
      limits: {
        pnlHistory: false,
        analytics: false,
        visualizer: false,
        prioritySupport: false,
        earlyFeatures: false,
      }
    },
    {
      id: 'pro' as const,
      name: 'Pro',
      price: 5,
      interval: 'month',
      features: [
        'Everything in Free',
        'Full PNL History (All Timeframes)',
        'Portfolio Analytics Dashboard',
        'Transaction Visualizer',
        'Advanced Transaction Filters',
        'Priority Support',
        'Early Access to New Features',
        'Pro Badge on Profile',
      ],
      limits: {
        pnlHistory: true,
        analytics: true,
        visualizer: true,
        prioritySupport: true,
        earlyFeatures: true,
      }
    }
  ];

  const getPlanDescription = (id: 'free' | 'pro') => {
    switch (id) {
      case 'free':
        return 'Standard features for on-chain exploration and wallet tracking.';
      case 'pro':
        return 'Maximum capabilities, priority support, and early updates.';
    }
  };

  return (
    <div className="subscription-page">
      <div className="subscription-bg">
        <div className="subscription-orb subscription-orb-1" />
        <div className="subscription-orb subscription-orb-2" />
      </div>

      <header className="subscription-header">
        <span className="subscription-badge">Subscription Plans</span>
        <h1 className="subscription-title">Flexible Subscription Tiers</h1>
        <p className="subscription-subtitle">
          Scale your on-chain portfolio intelligence with tools built for the Movement Network.
        </p>
      </header>

      <div className="subscription-grid">
        {displayPlans.map((plan) => {
          const isCurrent = plan.id === currentTier;
          const isFeatured = plan.id === 'pro';

          return (
            <div
              key={plan.id}
              className={`subscription-card ${isFeatured ? 'featured' : ''}`}
            >
              {isFeatured && <div className="recommended-badge">Recommended</div>}

              <div className="subscription-card-header">
                <h3 className={`plan-tier-label ${plan.id === 'pro' ? 'pro-label' : ''}`}>
                  {plan.name}
                  {isCurrent && <span className="current-plan-badge">Current Plan</span>}
                </h3>
                
                <p className="subscription-plan-desc">{getPlanDescription(plan.id)}</p>

                <div className="subscription-price-row">
                  {plan.price === 0 ? (
                    <span className="subscription-price-free">Free</span>
                  ) : (
                    <>
                      <span className="subscription-price">${plan.price}</span>
                      <span className="subscription-price-period">/{plan.interval || 'mo'}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="subscription-divider" />

              <ul className="subscription-features">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="subscription-feature-item">
                    <span className="feature-check included">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    {feature}
                  </li>
                ))}

                {/* Excluded features for visual completeness */}
                {plan.id === 'free' && (
                  <>
                    <li className="subscription-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Full PNL History
                    </li>
                    <li className="subscription-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Portfolio Analytics
                    </li>
                    <li className="subscription-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Transaction Visualizer
                    </li>
                    <li className="subscription-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Priority Support
                    </li>
                  </>
                )}
              </ul>

              <button
                className={`subscription-cta ${isCurrent ? 'cta-current' : plan.id === 'free' ? 'cta-free' : 'cta-pro'}`}
                onClick={() => handleCtaClick(plan.id)}
                disabled={isCurrent}
              >
                {isCurrent ? 'Active Plan' : plan.price === 0 ? 'Downgrade' : 'Get Started'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
