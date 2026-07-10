import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PNLChart from './PNLChart';
import { NetWorthValueSkeleton, NetWorthMetaSkeleton } from './Skeletons';
import { getPrecisionDecimals } from '../../utils/dashboardUtils';
import { t } from '../../utils/language';
import { resolveEffectiveTier } from '../../utils/subscription';

export const ErrorMessage = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="error-message">
    <p>{message}</p>
    {onRetry && <button onClick={onRetry} className="retry-btn">Retry</button>}
  </div>
);

export const DashboardHero = ({
  viewingAddress,
  entityBranding,
  setShowProfileModal,
  userAvatarSrc,
  userProfile,
  canEditProfile,
  navigate,
  hideValues,
  setHideValues,
  isRefreshing,
  handleRefresh,
  lastRefresh,
  combinedNetWorth,
  assetsLoading,
  error,
  convertUSD,
  formatCurrencyValue,
  setShowToast,
  showToast,
  walletAge,
  addressLabel,
  language,
  assetBreakdownData,
  protocolBreakdownData,
  balances,
  priceChanges,
  defiNetValue,
  liquidityTotalValue,
  stakingTotalValue,
  visibleDeFiPositions,
  visibleLiquidityPositions,
  visibleStakingPositions
}: any) => {

  const formatWalletAge = (ageData: { firstTxTimestamp?: string } | null): string | null => {
    if (!ageData?.firstTxTimestamp) return null;
    const firstDate = new Date(ageData.firstTxTimestamp);
    const now = new Date();
    const diffMs = now.getTime() - firstDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 1) return "< 1";
    return diffDays.toString();
  };

  return (
    <section className="hero-v3 fade-in">
      <div className="hero-v3-left">
        {viewingAddress && (
          <div className="hero-profile-section">
            <div className="hero-profile-card">
              <div
                className={`hero-profile-avatar ${entityBranding ? 'non-interactive' : ''}`}
                onClick={() => !entityBranding && setShowProfileModal(true)}
                role={entityBranding ? "img" : "button"}
                tabIndex={entityBranding ? -1 : 0}
                onKeyPress={(e) => !entityBranding && e.key === 'Enter' && setShowProfileModal(true)}
                style={{ cursor: entityBranding ? 'default' : 'pointer' }}
              >
                <img
                  src={userAvatarSrc}
                  alt="User"
                  className="hero-avatar-image"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/pfp/default.png'; }}
                />
              </div>
              <div className="hero-profile-socials-grid">
                <a
                  href={entityBranding?.twitter ? entityBranding.twitter : (userProfile?.twitter ? `https://twitter.com/${userProfile.twitter.replace('@', '')}` : '#')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hero-social-link ${!(entityBranding?.twitter || userProfile?.twitter) ? 'disabled' : ''} ${canEditProfile && !(entityBranding?.twitter || userProfile?.twitter) ? 'can-add' : ''}`}
                  title={entityBranding?.twitter ? "Twitter" : (userProfile?.twitter ? `Twitter: @${userProfile.twitter.replace('@', '')}` : (canEditProfile ? "Add Twitter" : "No Twitter added"))}
                  onClick={(e) => {
                    if (!(entityBranding?.twitter || userProfile?.twitter)) {
                      e.preventDefault();
                      if (canEditProfile) navigate('/profile');
                    }
                  }}
                >
                  <span className="hero-social-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zm-1.292 19.49h2.039L6.486 3.24H4.298l13.311 17.403z" />
                    </svg>
                  </span>
                  {canEditProfile && !(entityBranding?.twitter || userProfile?.twitter) && (
                    <span className="add-social-plus">+</span>
                  )}
                </a>

                <a
                  href={entityBranding?.website ? (entityBranding.website.startsWith('http') ? entityBranding.website : `https://${entityBranding.website}`) : (userProfile?.telegram ? (userProfile.telegram.startsWith('http') ? userProfile.telegram : `https://${userProfile.telegram}`) : '#')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hero-social-link ${!(entityBranding?.website || userProfile?.telegram) ? 'disabled' : ''} ${canEditProfile && !(entityBranding?.website || userProfile?.telegram) ? 'can-add' : ''}`}
                  title={entityBranding?.website ? "Website" : (userProfile?.telegram ? "Telegram" : (canEditProfile ? "Add Website/Telegram" : "No Website/Telegram added"))}
                  onClick={(e) => {
                    if (!(entityBranding?.website || userProfile?.telegram)) {
                      e.preventDefault();
                      if (canEditProfile) navigate('/profile');
                    }
                  }}
                >
                  <span className="hero-social-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3"></path>
                      <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                  </span>
                  {canEditProfile && !(entityBranding?.website || userProfile?.telegram) && (
                    <span className="add-social-plus">+</span>
                  )}
                </a>
                <button
                  className="hero-social-link"
                  title="Share Profile"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    setShowToast(true);
                    setTimeout(() => setShowToast(false), 2000);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="hero-social-icon">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                    <polyline points="16 6 12 2 8 6"></polyline>
                    <line x1="12" y1="2" x2="12" y2="15"></line>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="hero-v3-main-content">
          <div className="hero-v3-title-row">
            <span className="hero-v3-title">
              {entityBranding?.name ? (
                <>
                  <span className="hero-v3-entity-name-highlight">{entityBranding.name}</span>
                  <span className="hero-v3-title-suffix">{t(language, 'dashNetWorth')}</span>
                </>
              ) : userProfile?.username ? (
                <>
                  <span className="hero-v3-entity-name-highlight">
                    {userProfile.username}
                  </span>
                  <span className="hero-v3-title-suffix">{t(language, 'dashNetWorth')}</span>
                </>
              ) : t(language, 'dashNetWorth')}
            </span>
            <div className="hero-v3-left-actions">
              <div className="hero-v3-actions-capsule">
                <button
                  className="hero-action-btn-v4"
                  onClick={() => setHideValues((prev: any) => !prev)}
                  title={hideValues ? "Show Values" : "Hide Values"}
                >
                  {hideValues ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className={`hero-action-btn-v4 ${isRefreshing ? 'spin' : ''}`}
                  onClick={handleRefresh}
                  disabled={isRefreshing || (Date.now() - lastRefresh < 30000)}
                  title="Refresh Data"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="hero-v3-value-container">
            <div className="hero-v3-value">
              {assetsLoading ? <NetWorthValueSkeleton /> :
                error ? <span style={{ fontSize: "24px", opacity: 0.7 }}>Error</span> :
                  <span style={hideValues ? { fontSize: '0.7em', display: 'inline-block', transform: 'translateY(-4px)', letterSpacing: '4px' } : {}}>
                    {hideValues ? '*****' : (() => {
                      const netWorthConverted = convertUSD(combinedNetWorth);
                      return formatCurrencyValue(netWorthConverted, undefined, getPrecisionDecimals(netWorthConverted));
                    })()}
                  </span>
              }
            </div>
          </div>

          <div className="hero-v3-meta">
            {assetsLoading ? (
              <NetWorthMetaSkeleton />
            ) : viewingAddress ? (
              <>
                <div className="hero-v3-address-inline">
                  <span className="address-text">{viewingAddress}</span>
                  <button
                    className="copy-btn"
                    onClick={(e) => {
                      navigator.clipboard.writeText(viewingAddress);
                      setShowToast(true);
                      setTimeout(() => setShowToast(false), 2000);
                    }}
                    title="Copy address"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="copy-icon-svg">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                  {userProfile?.is_verified && (
                    <span className="verified-tick" title="Pro User">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                    </span>
                  )}
                  {walletAge && formatWalletAge(walletAge) && (
                    <>
                      <span className="address-age-separator">|</span>
                      <span className="address-age-text">{formatWalletAge(walletAge)} {t(language, 'dashDays').toLowerCase()}</span>
                    </>
                  )}
                  {addressLabel && (
                    <span className="exchange-label-badge" title="Known Exchange Deposit Address">
                      {addressLabel}
                    </span>
                  )}
                </div>
                {userProfile?.bio ? (
                  <div className="hero-v3-bio">
                    {userProfile.bio}
                  </div>
                ) : canEditProfile ? (
                  <div
                    className="hero-v3-bio-nudge"
                    onClick={() => navigate('/profile')}
                    role="button"
                    tabIndex={0}
                    onKeyPress={(e) => e.key === 'Enter' && navigate('/profile')}
                  >
                    <span>{t(language, 'profileBioPlaceholder') || "Add a bio to introduce yourself"}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="bio-nudge-icon">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </div>
                ) : (
                  <div className="hero-v3-bio empty-guest">
                    ( {t(language, 'profileNoBioGuest') || "This user has not added a bio yet"} )
                  </div>
                )}
              </>
            ) : (
              <span className="hero-v3-label">{t(language, 'dashNoWalletConnected')}</span>
            )}
          </div>
        </div>
      </div>

      <div className="hero-v3-right">
        <PNLChart
          hideValues={hideValues}
          setHideValues={setHideValues}
          handleRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          lastRefresh={lastRefresh}
          totalValue={combinedNetWorth}
          assetBreakdown={assetBreakdownData}
          protocolBreakdown={protocolBreakdownData}
          walletAddress={viewingAddress}
          subscriptionTier={resolveEffectiveTier(userProfile)}
          balances={balances}
          priceChanges={priceChanges}
          hasProfile={!!userProfile}
          staticExtraUsd={defiNetValue + liquidityTotalValue + stakingTotalValue}
          allPositions={visibleDeFiPositions}
          liquidityPositions={visibleLiquidityPositions}
          stakingPositions={visibleStakingPositions}
        />
      </div>
      {error && <ErrorMessage message={error} onRetry={handleRefresh} />}

      <AnimatePresence>
        {showToast && (
          <motion.div
            className="copy-toast"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="toast-content">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Copied</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
