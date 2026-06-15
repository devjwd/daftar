/**
 * PortfolioTabs — Tab navigation bar for Dashboard
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../../utils/language';
import { isPremiumTier, resolveEffectiveTier } from '../../utils/subscription';
import './PortfolioTabs.css';

const PORTFOLIO_TABS = {
  OVERVIEW: 'overview',
  TRX: 'trx',
  NFT: 'nfts',
  ANALYTICS: 'analytics',
};

interface PortfolioTabsProps {
  activeTab: string;
  urlAddress: string | undefined;
  canEditProfile: boolean;
  language: string;
  subscriptionTier?: 'free' | 'lite' | 'pro';
  isVerified?: boolean;
}

const PortfolioTabs: React.FC<PortfolioTabsProps> = ({
  activeTab,
  urlAddress,
  language,
  subscriptionTier = 'free',
  isVerified = false,
}) => {
  const navigate = useNavigate();

  const effectiveTier = resolveEffectiveTier({
    subscription_tier: subscriptionTier,
    is_verified: isVerified,
  });
  const isPremium = isPremiumTier(effectiveTier);

  return (
    <section className="portfolio-tabs-row fade-in" style={{ position: 'relative', zIndex: 100 }}>
      <button
        type="button"
        className={`portfolio-tab-btn ${activeTab === PORTFOLIO_TABS.OVERVIEW ? 'active' : ''}`}
        onClick={() => navigate(`/profile/${urlAddress}`)}
      >
        {t(language, 'navPortfolio')}
      </button>
      <button
        type="button"
        className={`portfolio-tab-btn ${activeTab === PORTFOLIO_TABS.TRX ? 'active' : ''}`}
        onClick={() => navigate(`/profile/${urlAddress}/${PORTFOLIO_TABS.TRX}`)}
      >
        {t(language, 'portfolioTabTrxHistory')}
      </button>
      <button
        type="button"
        className={`portfolio-tab-btn ${activeTab === PORTFOLIO_TABS.NFT ? 'active' : ''}`}
        onClick={() => navigate(`/profile/${urlAddress}/${PORTFOLIO_TABS.NFT}`)}
      >
        {t(language, 'portfolioTabNfts')}
      </button>

      <div className="analytics-tab-wrapper" style={{ marginLeft: 'auto', position: 'relative' }}>
        <button
          type="button"
          className={`portfolio-tab-btn analytics-tab-v4 ${activeTab === PORTFOLIO_TABS.ANALYTICS ? 'active' : ''}`}
          onClick={() => {
            if (!isPremium) {
              // Hover popup handles the upgrade message now
              return;
            } else {
              navigate(`/profile/${urlAddress}/${PORTFOLIO_TABS.ANALYTICS}`);
            }
          }}
          title={!isPremium ? 'Pro subscription required' : undefined}
        >
          <div className="analytics-btn-content">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            {t(language, 'portfolioTabAnalytics')}
            {!isPremium && (
              <span className="pro-diamond-icon" aria-hidden="true" style={{ marginLeft: '6px', display: 'flex', alignItems: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3h12l4 6-10 13L2 9Z" />
                <path d="M11 3 8 9l4 13" />
                <path d="M13 3l3 6-4 13" />
              </svg>
            </span>
            )}
          </div>
        </button>

        {!isPremium && (
          <div className="upgrade-hover-popover fade-in-up">
            <div className="upgrade-popover-content">
              <h4 className="upgrade-popover-title">Upgrade for Analytics</h4>
              <p className="upgrade-popover-desc">
                Understand who is doing what onchain. Identify Smart Money wallets, key entities, and their behavior in a flash.
              </p>
              <div className="upgrade-popover-actions">
                <button className="upgrade-popover-learn" onClick={() => navigate('/plans')}>Learn more</button>
                <button className="upgrade-popover-cta" onClick={() => navigate('/plans')}>Upgrade Now</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default PortfolioTabs;
export { PORTFOLIO_TABS };
