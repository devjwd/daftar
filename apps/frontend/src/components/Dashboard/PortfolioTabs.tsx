/**
 * PortfolioTabs — Tab navigation bar for Dashboard
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../../utils/language';
import { isPremiumTier, resolveEffectiveTier } from '../../utils/subscription';

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
  onProFeatureClick?: () => void;
}

const PortfolioTabs: React.FC<PortfolioTabsProps> = ({
  activeTab,
  urlAddress,
  language,
  subscriptionTier = 'free',
  isVerified = false,
  onProFeatureClick,
}) => {
  const navigate = useNavigate();

  const effectiveTier = resolveEffectiveTier({
    subscription_tier: subscriptionTier,
    is_verified: isVerified,
  });
  const isPremium = isPremiumTier(effectiveTier);

  return (
    <section className="portfolio-tabs-row fade-in">
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

      <button
        type="button"
        className={`portfolio-tab-btn analytics-tab-v4 ${activeTab === PORTFOLIO_TABS.ANALYTICS ? 'active' : ''}`}
        onClick={() => {
          if (!isPremium && onProFeatureClick) {
            onProFeatureClick();
          } else {
            navigate(`/profile/${urlAddress}/${PORTFOLIO_TABS.ANALYTICS}`);
          }
        }}
        style={{ marginLeft: 'auto' }}
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
            <span className="portfolio-tab-lock" aria-hidden="true" style={{ marginLeft: '6px', opacity: 0.7 }}>
              🔒
            </span>
          )}
        </div>
      </button>
    </section>
  );
};

export default PortfolioTabs;
export { PORTFOLIO_TABS };
