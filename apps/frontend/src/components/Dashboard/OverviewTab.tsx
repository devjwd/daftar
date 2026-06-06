import React from 'react';
import { ANIMATION_DELAYS } from '../../config/constants';
import { t } from '../../utils/language';
import { getDeFiPositionUsdValue, getPrecisionDecimals } from '../../utils/dashboardUtils';
import { TOKEN_VISUALS } from '../../config/display';
import TokenCard from './TokenCard';
import DeFiPositionCard from './DeFiPositionCard';
import LiquidityCard from './LiquidityCard';
import { resolveTokenPrice } from '../../utils/price';
import {
  SkeletonCard,
  LiquiditySkeleton,
  DeFiSkeleton,
} from './Skeletons';

const getRemainingTimeStr = (lockedUntilSecs: number) => {
  if (!lockedUntilSecs) return "";
  const nowSecs = Math.floor(Date.now() / 1000);
  const diffSecs = lockedUntilSecs - nowSecs;
  if (diffSecs <= 0) return "Ready";

  const days = Math.floor(diffSecs / 86400);
  const hours = Math.floor((diffSecs % 86400) / 3600);
  if (days > 0) {
    return `${days}d ${hours}h left`;
  }
  return `${hours}h left`;
};

interface OverviewTabProps {
  language: string;
  hideValues: boolean;
  viewMode: string;
  setViewMode: (mode: string) => void;
  allDeFiExpanded: boolean;
  setAllDeFiExpanded: (v: boolean) => void;
  balances: any[];
  indexerLoading: boolean;
  defiLoading: boolean;
  assetsLoading: boolean;
  lpLoading: boolean;
  indexerError: any;
  error: string | null;
  viewingAddress: string | null;
  totalUsdValue: number;
  defiNetValue: number;
  liquidityTotalValue: number;
  stakingTotalValue: number;
  visibleDeFiPositions: any[];
  visibleLiquidityPositions: any[];
  visibleStakingPositions: any[];
  priceMap: any;
  convertUSD: (val: number) => number;
  formatCurrencyValue: (val: number, currency?: string, decimals?: number) => string;
  currencySymbol: string;
}

const OverviewTab: React.FC<OverviewTabProps> = ({
  language,
  hideValues,
  viewMode,
  setViewMode,
  allDeFiExpanded,
  setAllDeFiExpanded,
  balances,
  indexerLoading,
  defiLoading,
  assetsLoading,
  lpLoading,
  indexerError,
  error,
  viewingAddress,
  totalUsdValue,
  defiNetValue,
  liquidityTotalValue,
  stakingTotalValue,
  visibleDeFiPositions,
  visibleLiquidityPositions,
  visibleStakingPositions,
  priceMap,
  convertUSD,
  formatCurrencyValue,
  currencySymbol,
}) => {
  const handleStakingReportClick = (e: React.MouseEvent, pos: any) => {
    e.preventDefault();
    e.stopPropagation();
    const event = new CustomEvent('open-bug-report', {
      detail: {
        type: 'token',
        symbol: pos.name || pos.protocolName || 'Movement Native Staking',
        address: pos.protocolWebsite || pos.poolAddress || pos.id || ''
      }
    });
    window.dispatchEvent(event);
  };

  return (
    <>
      {/* Wallet Balance Section */}
      <section className="grid-section">
        <div className="section-header-row">
          <div className="section-title-group">
            <h3 className="section-title">{t(language, 'dashWalletBalance')}</h3>
            <div className="section-header-value">
              {hideValues ? '*****' : (() => {
                const val = convertUSD(totalUsdValue);
                return formatCurrencyValue(val, undefined, getPrecisionDecimals(val));
              })()}
            </div>
          </div>
          <div className="view-mode-toggle">
            <button
              className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Table View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className={viewMode === 'grid' ? "grid-container" : "token-table-container"}>
          {indexerLoading && viewMode === 'grid' && (
            <>
              <SkeletonCard delay={0} />
              <SkeletonCard delay={50} />
              <SkeletonCard delay={100} />
              <SkeletonCard delay={150} />
            </>
          )}

          {indexerLoading && viewMode === 'table' && (
            <div className="table-skeleton">{t(language, 'dashLoadingTokens') || 'Loading tokens...'}</div>
          )}

          {!indexerLoading && !error && balances.length === 0 && (
            <div className="empty-state">
              {viewingAddress ? t(language, 'dashNoTokens') : t(language, 'dashConnectPortfolio')}
            </div>
          )}

          {!indexerLoading && balances.length > 0 && (
            viewMode === 'grid' ? (
              balances.map((token, index) => (
                <TokenCard
                  key={token.id}
                  token={token}
                  delay={index * ANIMATION_DELAYS.TOKEN_CARD}
                  convertUSD={convertUSD}
                  formatCurrencyValue={formatCurrencyValue}
                  language={language}
                  hideValues={hideValues}
                />
              ))
            ) : (
              <div className="token-table-scroll">
                <table className="token-table">
                  <thead>
                    <tr>
                      <th className="text-left">Token</th>
                      <th className="text-right">Price</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((token) => {
                      const baseSymbol = String(token.symbol || '').toUpperCase().replace(/\.E$/i, '').replace(/^CV/, '').replace(/^L/, '');
                      const visual = TOKEN_VISUALS[baseSymbol] || TOKEN_VISUALS[token.symbol?.toUpperCase()] || null;

                      return (
                        <tr key={token.id}>
                          <td className="text-left">
                            <div className="token-cell">
                              <div className="token-table-logo">
                                <img
                                  src={visual?.logo || '/movement-logo.svg'}
                                  alt={token.symbol}
                                  onError={(e) => { (e.target as HTMLImageElement).src = '/movement-logo.svg'; }}
                                />
                              </div>
                              <div className="token-cell-info">
                                <span className="token-table-symbol">{token.symbol}</span>
                              </div>
                            </div>
                          </td>
                          <td className="text-right">
                            <span className="token-table-price">
                              {hideValues ? '*****' : (() => {
                                const val = convertUSD(token.price || 0);
                                return formatCurrencyValue(val, undefined, getPrecisionDecimals(val));
                              })()}
                            </span>
                          </td>
                          <td className="text-right">
                            <span className="token-table-amount">
                              {hideValues ? '*****' : token.numericAmount.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: token.numericAmount < 0.01 ? 8 : 4
                              })}
                            </span>
                          </td>
                          <td className="text-right">
                            <span className="token-table-value highlight">
                              {hideValues ? '*****' : (() => {
                                const val = convertUSD(token.usdValue || 0);
                                return formatCurrencyValue(val, undefined, getPrecisionDecimals(val));
                              })()}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </section>

      {/* DeFi Positions Section */}
      <section className="grid-section">
        <div className="section-header-row">
          <div className="section-title-group">
            <h3 className="section-title">{t(language, 'dashDefiPositions')}</h3>
            <div className="section-header-value">
              {hideValues ? '*****' : (() => {
                const val = convertUSD(defiNetValue);
                return (val >= 0 ? '+' : '') + formatCurrencyValue(val, undefined, getPrecisionDecimals(val));
              })()}
            </div>
          </div>
          <button
            className="global-toggle-btn"
            onClick={() => setAllDeFiExpanded(!allDeFiExpanded)}
          >
            {allDeFiExpanded ? (
              <>
                <span>Minimize</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                </svg>
              </>
            ) : (
              <>
                <span>Expand</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </>
            )}
          </button>
        </div>
        <div className="grid-container">
          {(defiLoading || assetsLoading) && visibleDeFiPositions.length === 0 && (
            <>
              <DeFiSkeleton delay={0} />
              <DeFiSkeleton delay={50} />
              <DeFiSkeleton delay={100} />
              <DeFiSkeleton delay={150} />
            </>
          )}

          {!defiLoading && !assetsLoading && visibleDeFiPositions.length === 0 && viewingAddress && (
            <div className="empty-state">{t(language, 'dashNoDefi')}</div>
          )}

          {!defiLoading && !assetsLoading && visibleDeFiPositions.length === 0 && !viewingAddress && (
            <div className="empty-state">{t(language, 'dashConnectDefi')}</div>
          )}

          {visibleDeFiPositions.length > 0 && (() => {
            const groupedByProtocol = visibleDeFiPositions.reduce((acc, pos) => {
              const key = pos.protocolName || 'Unknown';
              if (!acc[key]) acc[key] = [];
              acc[key].push(pos);
              return acc;
            }, {});

            const sortedProtocolEntries = Object.entries(groupedByProtocol)
              .map(([protocolName, protocolPositions]: [string, any]) => {
                const netUsd = (protocolPositions as any[]).reduce((sum, pos) => {
                  const usdValue = getDeFiPositionUsdValue(pos, priceMap) ?? 0;
                  const isDebt = pos.type === 'Debt';
                  return sum + (isDebt ? -usdValue : usdValue);
                }, 0);
                return { protocolName, protocolPositions, netUsd };
              })
              .sort((a, b) => b.netUsd - a.netUsd);

            return sortedProtocolEntries.map(({ protocolName, protocolPositions }, index) => (
              <DeFiPositionCard
                key={protocolName}
                protocolPositions={protocolPositions}
                delay={index * ANIMATION_DELAYS.TOKEN_CARD}
                priceMap={priceMap}
                convertUSD={convertUSD}
                formatCurrencyValue={formatCurrencyValue}
                currencySymbol={currencySymbol}
                language={language}
                hideValues={hideValues}
                isExpanded={allDeFiExpanded}
              />
            ));
          })()}
        </div>
      </section>

      {/* Liquidity Positions Section */}
      <section className="grid-section">
        <div className="section-header-row">
          <div className="section-title-group">
            <h3 className="section-title">{t(language, 'dashLiquidityPositions')}</h3>
            <div className="section-header-value">
              {hideValues ? '*****' : (() => {
                const val = convertUSD(liquidityTotalValue);
                return formatCurrencyValue(val, undefined, getPrecisionDecimals(val));
              })()}
            </div>
          </div>
        </div>
        <div className="grid-container lp-grid">
          {(lpLoading || indexerLoading) && visibleLiquidityPositions.length === 0 && (
            <>
              <LiquiditySkeleton delay={0} />
              <LiquiditySkeleton delay={50} />
              <LiquiditySkeleton delay={100} />
              <LiquiditySkeleton delay={150} />
            </>
          )}

          {!lpLoading && !indexerLoading && visibleLiquidityPositions.length === 0 && viewingAddress && (
            <div className="empty-state">{t(language, 'dashNoLiquidity')}</div>
          )}

          {!lpLoading && !indexerLoading && visibleLiquidityPositions.length === 0 && !viewingAddress && (
            <div className="empty-state">{t(language, 'dashConnectLiquidity')}</div>
          )}

          {!indexerLoading && visibleLiquidityPositions.length > 0 && visibleLiquidityPositions.map((position, index) => (
            <LiquidityCard
              key={position.id}
              position={position}
              delay={index * ANIMATION_DELAYS.TOKEN_CARD}
              priceMap={priceMap}
              convertUSD={convertUSD}
              formatCurrencyValue={formatCurrencyValue}
              currencySymbol={currencySymbol}
              language={language}
              hideValues={hideValues}
            />
          ))}
        </div>
      </section>

      {/* Staking Positions Section */}
      <section className="grid-section">
        <div className="section-header-row">
          <div className="section-title-group">
            <h3 className="section-title">{t(language, 'dashStakingPositions')}</h3>
            <div className="section-header-value">
              {hideValues ? '*****' : (() => {
                const val = convertUSD(stakingTotalValue);
                return formatCurrencyValue(val, undefined, getPrecisionDecimals(val));
              })()}
            </div>
          </div>
        </div>
        
        <div className="staking-grid">
          {(!lpLoading && !indexerLoading) && visibleStakingPositions.length === 0 && viewingAddress && (
            <div className="empty-state">{t(language, 'dashNoStaking')}</div>
          )}

          {(!lpLoading && !indexerLoading) && visibleStakingPositions.length === 0 && !viewingAddress && (
            <div className="empty-state">{t(language, 'dashConnectStaking')}</div>
          )}

          {visibleStakingPositions.length > 0 && visibleStakingPositions.map((pos, index) => {
            const movePrice = resolveTokenPrice(priceMap, '0xa', 'MOVE');
            const posValue = pos.amount * movePrice;
            const website = pos.protocolWebsite || "https://staking.movementnetwork.xyz/";
            
            return (
              <div
                key={pos.id}
                className="staking-card-v2"
                style={{
                  animationDelay: `${index * ANIMATION_DELAYS.TOKEN_CARD}ms`
                } as React.CSSProperties}
              >
                <div className="staking-v2-header">
                  <div className="staking-v2-logo">
                    <img
                      src="/movement-logo.svg"
                      alt="Movement"
                      onError={(e) => { (e.target as HTMLImageElement).src = '/movement-logo.svg'; }}
                    />
                  </div>
                  <div className="staking-v2-info">
                    <h4>{pos.name || pos.protocolName || "Movement Native Staking"}</h4>
                    <span className="staking-v2-type">Native Staking</span>
                  </div>
                  <div className="staking-v2-action-group">
                    <button
                      type="button"
                      className="staking-v2-report-flag"
                      onClick={(e) => handleStakingReportClick(e, pos)}
                      title="Report incorrect staking data"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                        <line x1="4" y1="22" x2="4" y2="15" />
                      </svg>
                    </button>
                    {website && (
                      <a
                        href={website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="staking-v2-link"
                        title={`Open ${pos.name || pos.protocolName || "staking"} website`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
                <div className="staking-v2-body">
                  <div className="staking-v2-stats-row">
                    <div className="staking-v2-stat">
                      <span className="staking-v2-stat-label">Balance</span>
                      <span className="staking-v2-stat-value">
                        {hideValues ? '*****' : `${pos.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} MOVE`}
                      </span>
                    </div>
                    <div className="staking-v2-stat">
                      <span className="staking-v2-stat-label">Value</span>
                      <span className="staking-v2-stat-value highlight">
                        {hideValues ? '*****' : formatCurrencyValue(convertUSD(posValue), undefined, getPrecisionDecimals(convertUSD(posValue)))}
                      </span>
                    </div>
                  </div>
                  <div className="staking-v2-details">
                    {pos.poolAddress && (
                      <div className="staking-v2-detail-row">
                        <span className="staking-v2-stat-label">Pool</span>
                        <span className="staking-v2-stat-value small font-mono">
                          {pos.poolAddress.slice(0, 6)}...{pos.poolAddress.slice(-4)}
                        </span>
                      </div>
                    )}
                    {pos.details?.inactive > 0 && (
                      <div className="staking-v2-detail-row">
                        <span className="staking-v2-stat-label">Withdrawable</span>
                        <span className="staking-v2-stat-value small success">
                          {pos.details.inactive.toLocaleString(undefined, { maximumFractionDigits: 4 })} MOVE
                        </span>
                      </div>
                    )}
                    {pos.details?.pendingInactive > 0 && (
                      <div className="staking-v2-detail-row">
                        <span className="staking-v2-stat-label">Unlocking</span>
                        <span className="staking-v2-stat-value small warning">
                          {pos.details.pendingInactive.toLocaleString(undefined, { maximumFractionDigits: 4 })} MOVE ({getRemainingTimeStr(pos.lockedUntilSecs)})
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
};

export default OverviewTab;
