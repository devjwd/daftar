import React from 'react';
import { t } from '../../utils/language';
import { TokenIcon, renderColoredTokenText, humanizeAssetName, getPrecisionDecimals } from '../../utils/dashboardUtils';
import { resolveTokenPrice } from '../../utils/price';

interface LiquidityCardProps {
  position: any;
  delay: number;
  priceMap: Record<string, number>;
  convertUSD: (val: number) => number;
  formatCurrencyValue: (val: number, currency?: string, decimals?: number) => string;
  currencySymbol: string;
  language: string;
  hideValues?: boolean;
}

const LiquidityCard: React.FC<LiquidityCardProps> = ({
  position,
  delay,
  priceMap,
  convertUSD,
  formatCurrencyValue,
  currencySymbol,
  language,
  hideValues
}) => {
  const handleReportClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const event = new CustomEvent('open-bug-report', {
      detail: {
        type: 'token',
        symbol: position.symbol || '',
        address: position.poolAddress || position.id || ''
      }
    });
    window.dispatchEvent(event);
  };

  const LP_PROTOCOLS: Record<string, any> = {
    canopy: {
      logo: '/canopy.png',
      name: 'Canopy Finance',
      color: '#22c55e',
      gradient: 'linear-gradient(135deg, #22c55e, #4ade80)',
      type: 'Liquid Staking',
      website: 'https://app.canopyhub.xyz/'
    },
    meridian: {
      logo: '/Meridian.png',
      name: 'Meridian',
      color: '#8b5cf6',
      gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
      type: 'LP Token',
      website: 'https://app.meridian.money/'
    },
    yuzu: {
      logo: '/yuzu.png',
      name: 'Yuzu Swap',
      color: '#eab308',
      gradient: 'linear-gradient(135deg, #eab308, #facc15)',
      type: 'LP Token',
      website: 'https://app.yuzu.finance/'
    },
  };

  const protocol = LP_PROTOCOLS[position.protocol] || {
    logo: '/movement-logo.svg',
    name: position.protocolName || 'DeFi Protocol',
    color: '#cda169',
    gradient: 'linear-gradient(135deg, #cda169, #deb884)',
    type: 'LP Token',
    website: null
  };

  const isCanopyDeposit = position.protocol === 'canopy' ||
    position.symbol?.startsWith('cv') ||
    position.symbol?.includes('stMOVE');

  const formatValue = (val: any) => {
    if (hideValues) return '*****';
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  const formatUsd = (val: any) => {
    if (hideValues) return '*****';
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return formatCurrencyValue(0);
    const converted = convertUSD(num);
    if (converted >= 1000000) return `${currencySymbol}${(converted / 1000000).toFixed(2)}M`;
    if (converted >= 1000) return `${currencySymbol}${(converted / 1000).toFixed(2)}K`;
    return formatCurrencyValue(converted, undefined, getPrecisionDecimals(converted));
  };

  const getUnderlyingValue = () => {
    if (position.usdValue && position.usdValue > 0) {
      return position.usdValue;
    }

    if (position.liquidityValue && position.liquidityValue > 0) {
      return position.liquidityValue;
    }

    if (!priceMap) return 0;

    const amount = parseFloat(position.amount) || 0;
    if (amount === 0) return 0;

    if (position.isNFT && position.protocol === 'yuzu') {
      if (position.usdValue && position.usdValue > 0) return position.usdValue;
      if (position.liquidityValue) return position.liquidityValue;
      return 0;
    }

    const sym = position.symbol?.toUpperCase() || "";
    if (sym.includes('CVWBTC') || sym.includes('STWBTC') || sym.includes('WBTC')) {
      const btcPrice = (Object.entries(priceMap).find(([addr]) =>
        addr.toLowerCase().includes('wbtc') || addr.toLowerCase().includes('btc')
      )?.[1] || priceMap['0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c'] || 81096.63) as number;
      return amount * btcPrice;
    }

    if (sym.includes('CVWETH') || sym.includes('STWETH') || sym.includes('WETH') || sym.includes('ETH')) {
      const ethPrice = (Object.entries(priceMap).find(([addr]) =>
        addr.toLowerCase().includes('weth') || addr.toLowerCase().includes('eth')
      )?.[1] || priceMap['0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376'] || 2331.60) as number;
      return amount * ethPrice;
    }

    if (sym.includes('CVMOVE') || sym.includes('STMOVE') || (sym.includes('MOVE') && position.protocol === 'canopy') || sym.includes('LMOVE')) {
      const movePrice = priceMap['0xa'] || priceMap['0x1'] || 0;
      return amount * movePrice;
    }

    if (sym.includes('USDC') || sym.includes('USDT') ||
      position.underlying?.includes('USDC') || position.underlying?.includes('USDT')) {
      return amount;
    }

    return position.usdValue || (amount * resolveTokenPrice(priceMap, position.asset_type, position.symbol)) || 0;
  };

  const usdValue = getUnderlyingValue();
  const meridianPoolLabel = position.protocol === 'meridian'
    ? (
      Array.isArray(position.poolTokens) && position.poolTokens.length > 0
        ? position.poolTokens.map((token: any) => token.symbol).join(' / ')
        : (position.tokenX && position.tokenY ? `${position.tokenX} / ${position.tokenY}` : 'MER-LP')
    )
    : '';

  const isPoolStylePrimary = position.isNFT || position.protocol === 'meridian';
  const primaryLabel = isPoolStylePrimary ? 'Pool' : t(language, 'dashBalance');
  const primaryValue = position.isNFT
    ? (position.name || 'LP Position')
    : (position.protocol === 'meridian' ? meridianPoolLabel : formatValue(position.amount));
  const secondaryLabel = position.isNFT ? 'Position' : 'Underlying Asset';
  const secondaryValue = position.isNFT
    ? `#${position.positionId || position.tokenDataId?.slice(-8) || 'NFT'}`
    : humanizeAssetName(position.underlying || position.symbol?.replace('cv', '').replace('l', '') || 'MOVE');

  let detailLabel = t(language, 'dashUnderlying');
  let detailValue = humanizeAssetName(position.underlying || position.symbol?.replace('cv', '').replace('l', '') || t(language, 'dashNotAvailable'));

  if (position.isNFT && position.protocol === 'yuzu' && (position.token0Amount > 0 || position.token1Amount > 0)) {
    detailLabel = t(language, 'swapTokenAmounts');
    detailValue = `${position.token0Amount > 0 ? `${formatValue(position.token0Amount)} ${position.name?.split(' / ')[0] || 'Token0'}` : ''}${position.token0Amount > 0 && position.token1Amount > 0 ? ' + ' : ''}${position.token1Amount > 0 ? `${formatValue(position.token1Amount)} ${position.name?.split(' / ')[1] || 'Token1'}` : ''}`;
  } else if (position.protocol === 'meridian' && Array.isArray(position.poolTokens) && position.poolTokens.length > 0) {
    detailLabel = t(language, 'dashTokens');
    detailValue = position.poolTokens
      .map((token: any) => `${formatValue(token.amount)} ${token.symbol || 'Token'}`)
      .join(' + ');
  } else if (
    position.protocol === 'meridian' &&
    (!Array.isArray(position.poolTokens) || position.poolTokens.length === 0) &&
    (position.liquidityX > 0 || position.liquidityY > 0)
  ) {
    detailLabel = t(language, 'dashTokens');
    detailValue = `${position.liquidityX > 0 ? `${formatValue(position.liquidityX / 1000000)} ${position.tokenX || 'Token X'}` : ''}${position.liquidityX > 0 && position.liquidityY > 0 ? ' + ' : ''}${position.liquidityY > 0 ? `${formatValue(position.liquidityY / 1000000)} ${position.tokenY || 'Token Y'}` : ''}`;
  }

  const isLongDetailValue = detailLabel === t(language, 'swapTokenAmounts');
  const colorizePrimaryValue = isPoolStylePrimary;
  const colorizeDetailValue = detailLabel === t(language, 'swapTokenAmounts') || detailLabel === t(language, 'dashTokens') || detailLabel === t(language, 'dashUnderlying');
  const colorizeSecondaryValue = secondaryLabel === 'Underlying Asset';

  return (
    <div
      className="lp-card"
      style={{
        animationDelay: `${delay}ms`,
        '--lp-color': protocol.color
      } as React.CSSProperties}
    >
      <div className="lp-card-header">
        <div className="lp-card-logo">
          <img
            src={protocol.logo}
            alt={protocol.name}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.onerror = null;
              target.src = '/movement-logo.svg';
            }}
          />
        </div>
        <div className="lp-card-info">
          <h4 className="lp-card-name" title={protocol.name}>{protocol.name}</h4>
          <div className="lp-card-subline">
            <span className="lp-card-type">{protocol.type}</span>
            <span className="lp-card-dot">*</span>
            <span className="lp-card-symbol" title={position.symbol}>{position.symbol}</span>
          </div>
          {(position.isNFT || (isCanopyDeposit && position.protocol !== 'canopy')) && (
            <div className="lp-card-flags">
              {position.isNFT && <span className="lp-card-flag">NFT</span>}
              {isCanopyDeposit && position.protocol !== 'canopy' && <span className="lp-card-flag">via Canopy</span>}
            </div>
          )}
        </div>
        <div className="lp-card-action-group">
          <button
            type="button"
            className="lp-card-report-flag"
            onClick={handleReportClick}
            title="Report incorrect LP data"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
          </button>
          {protocol.website && (
            <a
              href={protocol.website}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-card-link"
              title={`Open ${protocol.name}`}
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

      <div className="lp-card-body">
        <div className="lp-card-stats-row">
          <div className="lp-card-stat">
            <span className="lp-card-stat-label">{primaryLabel}</span>
            <span className={`lp-card-stat-value ${isPoolStylePrimary ? 'text' : ''}`} title={primaryValue}>
              {colorizePrimaryValue ? renderColoredTokenText(primaryValue) : primaryValue}
            </span>
          </div>
          <div className="lp-card-stat">
            <span className="lp-card-stat-label">{t(language, 'dashLiquidity')}</span>
            <span className={`lp-card-stat-value highlight ${usdValue > 0 ? '' : 'na'}`}>
              {usdValue > 0 ? formatUsd(usdValue) : (position.usdValue > 0 ? formatUsd(position.usdValue) : 'Price N/A')}
            </span>
          </div>
        </div>

        <div className="lp-card-details">
          <div className={`lp-card-detail-row ${isLongDetailValue ? 'long' : ''}`}>
            <span className="lp-card-stat-label">{detailLabel}</span>
            <span className={`lp-card-stat-value small ${detailValue === 'Not available' ? 'muted' : ''}`} title={detailValue}>
              {colorizeDetailValue ? renderColoredTokenText(detailValue) : detailValue}
            </span>
          </div>
          <div className="lp-card-detail-row">
            <span className="lp-card-stat-label">{secondaryLabel}</span>
            <span className="lp-card-stat-value small" title={secondaryValue}>
              {colorizeSecondaryValue ? renderColoredTokenText(secondaryValue) : secondaryValue}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(LiquidityCard);
