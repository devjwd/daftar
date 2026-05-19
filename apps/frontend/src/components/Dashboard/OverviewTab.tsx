import React from 'react';
import { ANIMATION_DELAYS } from '../../config/constants';
import { t } from '../../utils/language';
import { getDeFiPositionUsdValue } from '../../utils/dashboardUtils';
import { TOKEN_VISUALS } from '../../config/display';
import TokenCard from './TokenCard';
import DeFiPositionCard from './DeFiPositionCard';
import LiquidityCard from './LiquidityCard';
import {
  SkeletonCard,
  LiquiditySkeleton,
  DeFiSkeleton,
} from './Skeletons';

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
  visibleDeFiPositions: any[];
  visibleLiquidityPositions: any[];
  priceMap: any;
  convertUSD: (val: number) => number;
  formatCurrencyValue: (val: number) => string;
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
  visibleDeFiPositions,
  visibleLiquidityPositions,
  priceMap,
  convertUSD,
  formatCurrencyValue,
  currencySymbol,
}) => {
  return (
    <>
      {/* Wallet Balance Section */}
      <section className="grid-section">
        <div className="section-header-row">
          <div className="section-title-group">
            <h3 className="section-title">{t(language, 'dashWalletBalance')}</h3>
            <div className="section-header-value">
              {hideValues ? '*****' : formatCurrencyValue(convertUSD(totalUsdValue))}
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
                              {hideValues ? '*****' : formatCurrencyValue(convertUSD(token.price || 0))}
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
                              {hideValues ? '*****' : formatCurrencyValue(convertUSD(token.usdValue || 0))}
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
              {hideValues ? '*****' : (defiNetValue >= 0 ? '+' : '') + formatCurrencyValue(convertUSD(defiNetValue))}
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
              {hideValues ? '*****' : formatCurrencyValue(convertUSD(liquidityTotalValue))}
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
    </>
  );
};

export default OverviewTab;
