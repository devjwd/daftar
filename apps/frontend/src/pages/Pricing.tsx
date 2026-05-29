import React, { useEffect, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useProfile } from '../hooks/useProfile';
import { getSubscriptionPlans } from '../services/api';
import './Pricing.css';

interface PlanDefinition {
  id: 'free' | 'lite' | 'pro';
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

export default function Pricing() {
  const { account, connected } = useWallet();
  const walletAddress = connected && account?.address ? String(account.address) : null;
  const { profile, loading: profileLoading } = useProfile(walletAddress);
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  // Derive current tier
  const currentTier = profile?.subscription_tier || (profile?.is_verified ? 'lite' : 'free');

  useEffect(() => {
    async function loadPlans() {
      try {
        const fetchedPlans = await getSubscriptionPlans();
        if (fetchedPlans && fetchedPlans.length > 0) {
          setPlans(fetchedPlans);
        }
      } catch (err) {
        console.error('Failed to load plans:', err);
      } finally {
        setLoadingPlans(false);
      }
    }
    loadPlans();
  }, []);

  const handleCtaClick = (planId: 'free' | 'lite' | 'pro') => {
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
      id: 'lite' as const,
      name: 'Lite',
      price: 2,
      interval: 'month',
      features: [
        'Everything in Free',
        'Full PNL History (All Timeframes)',
        'Portfolio Analytics Dashboard',
        'Transaction Visualizer',
        'Advanced Transaction Filters',
      ],
      limits: {
        pnlHistory: true,
        analytics: true,
        visualizer: true,
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
        'Everything in Lite',
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

  const getPlanDescription = (id: 'free' | 'lite' | 'pro') => {
    switch (id) {
      case 'free':
        return 'Standard features for on-chain exploration and wallet tracking.';
      case 'lite':
        return 'Advanced portfolio analytics and historical details for power users.';
      case 'pro':
        return 'Maximum capabilities, priority support, and early updates.';
    }
  };

  const isFeatureIncluded = (plan: typeof displayPlans[0], featureIndex: number, planId: 'free' | 'lite' | 'pro') => {
    // Free has 4 features, Lite has 5, Pro has 4 (plus lite ones)
    if (planId === 'free') {
      return featureIndex < 4;
    }
    if (planId === 'lite') {
      return true; // Lite includes all its listed features
    }
    if (planId === 'pro') {
      return true; // Pro includes all
    }
    return false;
  };

  // Matrix of all features for feature comparisons
  const COMPARISON_FEATURES = [
    { name: 'Portfolio Tracker', free: true, lite: true, pro: true },
    { name: 'Transaction History', free: true, lite: true, pro: true },
    { name: 'NFT Gallery', free: true, lite: true, pro: true },
    { name: 'PNL History Chart', free: '24h only', lite: 'All timeframes', pro: 'All timeframes' },
    { name: 'Portfolio Analytics', free: false, lite: true, pro: true },
    { name: 'Transaction Visualizer', free: false, lite: true, pro: true },
    { name: 'Priority Support', free: false, lite: false, pro: true },
    { name: 'Early Features', free: false, lite: false, pro: true },
  ];

  return (
    <div className="pricing-page">
      <div className="pricing-bg">
        <div className="pricing-orb pricing-orb-1" />
        <div className="pricing-orb pricing-orb-2" />
      </div>

      <header className="pricing-header">
        <span className="pricing-badge">Pricing Plans</span>
        <h1 className="pricing-title">Flexible Subscription Tiers</h1>
        <p className="pricing-subtitle">
          Scale your on-chain portfolio intelligence with tools built for the Movement Network.
        </p>
      </header>

      <div className="pricing-grid">
        {displayPlans.map((plan) => {
          const isCurrent = plan.id === currentTier;
          const isFeatured = plan.id === 'lite';
          const isPro = plan.id === 'pro';

          return (
            <div
              key={plan.id}
              className={`pricing-card ${isFeatured ? 'featured' : ''} ${isPro ? 'pro-card' : ''}`}
            >
              {isFeatured && <div className="recommended-badge">Recommended</div>}

              <div className="pricing-card-header">
                <h3 className={`plan-tier-label ${plan.id === 'lite' ? 'lite-label' : ''} ${plan.id === 'pro' ? 'pro-label' : ''}`}>
                  {plan.name}
                  {isCurrent && <span className="current-plan-badge">Current Plan</span>}
                </h3>
                
                <p className="pricing-plan-desc">{getPlanDescription(plan.id)}</p>

                <div className="pricing-price-row">
                  {plan.price === 0 ? (
                    <span className="pricing-price-free">Free</span>
                  ) : (
                    <>
                      <span className="pricing-price">${plan.price}</span>
                      <span className="pricing-price-period">/{plan.interval || 'mo'}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="pricing-divider" />

              <ul className="pricing-features">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="pricing-feature-item">
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
                    <li className="pricing-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Full PNL History
                    </li>
                    <li className="pricing-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Portfolio Analytics
                    </li>
                    <li className="pricing-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Transaction Visualizer
                    </li>
                  </>
                )}

                {plan.id === 'lite' && (
                  <>
                    <li className="pricing-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Priority Support
                    </li>
                    <li className="pricing-feature-item excluded-feature">
                      <span className="feature-check excluded">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                      Early Features
                    </li>
                  </>
                )}
              </ul>

              <button
                className={`pricing-cta ${isCurrent ? 'cta-current' : plan.id === 'free' ? 'cta-free' : plan.id === 'lite' ? 'cta-lite' : 'cta-pro'}`}
                onClick={() => handleCtaClick(plan.id)}
                disabled={isCurrent}
              >
                {isCurrent ? 'Active Plan' : plan.price === 0 ? 'Downgrade' : 'Get Started'}
              </button>
            </div>
          );
        })}
      </div>

      <section className="pricing-faq">
        <h2 className="pricing-faq-title">Frequently Asked Questions</h2>
        <div className="faq-grid">
          <div className="faq-item">
            <h4 className="faq-question">How do I subscribe?</h4>
            <p className="faq-answer">
              During our beta phase, subscriptions are assigned manually by our administration team. Tap "Get Started" on your desired plan to find contact details, and we will update your wallet status.
            </p>
          </div>
          <div className="faq-item">
            <h4 className="faq-question">What payment methods do you support?</h4>
            <p className="faq-answer">
              Currently we accept manual transfers. Full self-service checkout with Stripe and crypto payment options is coming soon.
            </p>
          </div>
          <div className="faq-item">
            <h4 className="faq-question">What features do I unlock on the Lite tier?</h4>
            <p className="faq-answer">
              Lite users unlock historical PNL charts, the interactive transaction flows visualizer, and advanced metrics under the Analytics tab.
            </p>
          </div>
          <div className="faq-item">
            <h4 className="faq-question">Can I cancel my subscription?</h4>
            <p className="faq-answer">
              Yes, subscriptions can be cancelled at any time by contacting our administrators. Your premium access will continue until the end of your billing cycle.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
