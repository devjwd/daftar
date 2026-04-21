import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import "../App.css";

import { DEFAULT_NETWORK } from "../config/network";
import { ANIMATION_DELAYS, FORMATTING, INTERVALS } from "../config/constants";
import { DEFAULT_PROTOCOL_VISUAL, DEFAULT_TOKEN_COLOR, DEFI_PROTOCOL_VISUALS, TOKEN_VISUALS } from "../config/display";
import { getTokenAddressBySymbol, getTokenInfo } from "../config/tokens";
import { useCurrency } from "../hooks/useCurrency";
import { useIndexerBalances } from "../hooks/useIndexerBalances";
import { useMovementClient } from "../hooks/useMovementClient";
import { useProfile } from "../hooks/useProfile";
import { useTokenPrices } from "../hooks/useTokenPrices";
import { useUserLevel } from "../hooks/useUserLevel";
import useBadges from "../hooks/useBadges";
import useUserBadges from "../hooks/useUserBadges";
import { useDeFiPositions } from "../hooks/useDeFiPositions";
import { getWalletAge, getUserNFTHoldings, getUserTokenBalances, getYuzuLiquidityPositions } from "../services/indexer";
import { getLevelBasedPfp } from "../utils/levelPfp";
import { getStoredLanguagePreference, t } from "../utils/language";
import { getSettingsStorageKey, getStoredHidePositionThreshold } from "../utils/settings";
import { devLog } from "../utils/devLogger";
import { getTokenDecimals, isValidAddress, parseCoinType } from "../utils/tokenUtils";
import ProfileCard from "../components/ProfileCard";
import { ALL_ADAPTERS } from "../config/adapters/index";

const TrxHistory = lazy(() => import("../components/TrxHistory"));
const PORTFOLIO_TABS = {
  OVERVIEW: "overview",
  TRX: "trx",
};

const LP_DISCOVERY_CACHE_TTL_MS = 90 * 1000;

const getTokenPriceFromMap = (symbol, priceMap) => {
  if (!priceMap) return null;

  const upperSymbol = (symbol || '').toUpperCase();
  const address = getTokenAddressBySymbol(upperSymbol);

  if (address && priceMap[address] !== undefined) {
    return Number(priceMap[address]) || 0;
  }

  if (upperSymbol === 'USDC' || upperSymbol === 'USDCX' || upperSymbol === 'USDT' || upperSymbol === 'USDA' || upperSymbol === 'USDE' || upperSymbol === 'SUSDE') {
    return 1;
  }

  return null;
};

const getDeFiPositionUsdValue = (position, priceMap) => {
  if (!position) return null;

  if (Number.isFinite(position.usdValue) && position.usdValue > 0) {
    return position.usdValue;
  }

  const amount = parseFloat(position.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const tokenPrice = getTokenPriceFromMap(position.tokenSymbol, priceMap);
  if (tokenPrice === null) return null;

  return amount * tokenPrice;
};

const getLiquidityPositionUsdValue = (position, priceMap) => {
  if (!position) return null;

  if (Number.isFinite(position.usdValue) && position.usdValue > 0) {
    return position.usdValue;
  }

  if (Number.isFinite(position.liquidityValue) && position.liquidityValue > 0) {
    return position.liquidityValue;
  }

  if (!priceMap) return null;

  const amount = parseFloat(position.amount) || 0;
  if (amount === 0) return 0;

  if (position.isNFT && position.protocol === 'yuzu') {
    return null;
  }

  if (position.isMeridianLP) {
    return null;
  }

  if (position.symbol?.includes('cvMOVE') || position.symbol?.includes('stMOVE') || position.symbol?.includes('MOVE') && position.protocol === 'canopy') {
    const movePrice = Number(priceMap['0xa'] || priceMap['0x1'] || 0);
    return movePrice > 0 ? amount * movePrice : null;
  }

  if (position.symbol?.includes('cvWBTC') || position.symbol?.includes('WBTC') || position.symbol?.includes('BTC')) {
    const btcPrice = Object.entries(priceMap).find(([addr]) =>
      addr.toLowerCase().includes('wbtc') || addr.toLowerCase().includes('btc')
    )?.[1];
    return btcPrice ? amount * Number(btcPrice) : null;
  }

  if (position.symbol?.includes('cvWETH') || position.symbol?.includes('WETH') || position.symbol?.includes('ETH')) {
    const ethPrice = Object.entries(priceMap).find(([addr]) =>
      addr.toLowerCase().includes('weth') || addr.toLowerCase().includes('eth')
    )?.[1];
    return ethPrice ? amount * Number(ethPrice) : null;
  }

  if (position.symbol?.includes('lMOVE')) {
    const movePrice = Number(priceMap['0xa'] || priceMap['0x1'] || 0);
    return movePrice > 0 ? amount * movePrice : null;
  }

  if (position.protocol === 'meridian' && position.symbol?.includes('MER-LP')) {
    return null;
  }

  if (position.symbol?.includes('USDC') || position.symbol?.includes('USDT') || position.underlying?.includes('USDC') || position.underlying?.includes('USDT')) {
    return amount;
  }

  return Number.isFinite(position.usdValue) ? position.usdValue : null;
};

const shouldDisplayPosition = (usdValue, threshold) => {
  // Always display positions if price is unknown (null/undefined) to avoid data loss
  if (usdValue === null || usdValue === undefined) return true;
  if (!threshold || threshold <= 0) return true;
  return usdValue >= threshold;
};

const TokenCard = ({ token, delay, convertUSD, formatCurrencyValue, language }) => {
  const tokenInfo = getTokenInfo(token.address);
  const isKnownToken = !!tokenInfo;

  const rawSymbol = String(tokenInfo?.symbol || token.symbol || '').trim();
  const symbol = rawSymbol.toUpperCase();
  const baseSymbol = symbol.replace(/\.E$/i, '');
  const visual = TOKEN_VISUALS[baseSymbol] || TOKEN_VISUALS[symbol] || null;
  const tokenLogo = visual?.logo || null;
  const tokenColor = visual?.color || DEFAULT_TOKEN_COLOR;
  const displayName = tokenInfo?.name || rawSymbol || t(language, 'dashToken');
  const displayMeta = rawSymbol || 'Movement';

  const usdValueNum = parseFloat(token.formattedValue?.replace('$', '').replace(',', '') || '0');
  const hasValue = usdValueNum > 0;

  const convertedValue = convertUSD ? convertUSD(usdValueNum) : usdValueNum;
  const displayValue = formatCurrencyValue ? formatCurrencyValue(convertedValue) : `$${usdValueNum.toFixed(2)}`;

  const HIGH_VALUE_COINS = ['ETH', 'WETH', 'BTC', 'WBTC', 'LBTC', 'EZETH', 'RSETH', 'SOLVBTC', 'WEETH'];
  const isHighValueCoin = HIGH_VALUE_COINS.some(coin => baseSymbol.includes(coin));
  const formattedAmount = isHighValueCoin
    ? (token.numericAmount || parseFloat(token.amount) || 0).toFixed(5)
    : token.amount;

  return (
    <div
      className={`token-card-new ${isKnownToken ? 'verified' : ''}`}
      style={{
        animationDelay: `${delay}ms`,
        '--token-color': tokenColor.primary,
        '--token-color-light': tokenColor.secondary,
      }}
    >
      <div className="token-card-glow" />

      <div className="token-card-content">
        <div className="token-card-left">
          <div className={`token-logo-wrapper ${tokenLogo ? 'has-image' : ''}`}>
            {tokenLogo ? (
              <img
                src={tokenLogo}
                alt={displayName}
                className="token-logo"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.parentElement.classList.remove('has-image');
                }}
              />
            ) : (
              <span className="token-initial">{symbol.charAt(0) || '?'}</span>
            )}
            {isKnownToken && (
              <div className="token-verified-dot">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1 4L3 6L7 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </div>

          <div className="token-info">
            <span className="token-network">{displayMeta}</span>
            <span className="token-symbol">{displayName}</span>
          </div>
        </div>

        <div className="token-card-right">
          <span className="token-balance">{formattedAmount}</span>
          <span className={`token-value ${hasValue ? 'has-value' : ''}`}>
            {displayValue}
          </span>
        </div>
      </div>

      <div className="token-card-accent" />
    </div>
  );
};

const SkeletonCard = ({ delay = 0 }) => (

  <div

    className="card skeleton-card"

    style={{ animationDelay: `${delay}ms`, cursor: 'default' }}

  >

    <div className="skeleton skeleton-circle"></div>

    <div className="skeleton-text" style={{ flex: 1 }}>

      <div className="skeleton skeleton-line" style={{ width: '80px' }}></div>

    </div>

    <div className="skeleton-text" style={{ minWidth: '100px' }}>

      <div className="skeleton skeleton-line" style={{ width: '80px' }}></div>

      <div className="skeleton skeleton-line" style={{ width: '60px', height: '12px' }}></div>

    </div>

  </div>

);

const NetWorthValueSkeleton = () => (

  <>

    <div className="hero-networth-skeleton-value skeleton" aria-hidden="true"></div>

    <div className="hero-networth-skeleton-pill skeleton" aria-hidden="true"></div>

  </>

);

const NetWorthMetaSkeleton = () => (

  <div className="hero-networth-skeleton-meta" aria-hidden="true">

    <div className="hero-networth-skeleton-address-row">

      <div className="hero-networth-skeleton-line address skeleton"></div>

      <div className="hero-networth-skeleton-copy skeleton"></div>

    </div>

    <div className="hero-networth-skeleton-line bio skeleton"></div>

  </div>

);

const NetWorthStatsSkeleton = () => (

  <div className="hero-networth-skeleton-stats" aria-hidden="true">

    <div className="hero-networth-skeleton-stat">

      <div className="hero-networth-skeleton-stat-value skeleton"></div>

      <div className="hero-networth-skeleton-stat-label skeleton"></div>

    </div>

    <div className="hero-networth-skeleton-stat">

      <div className="hero-networth-skeleton-stat-value skeleton"></div>

      <div className="hero-networth-skeleton-stat-label skeleton"></div>

    </div>

    <div className="hero-networth-skeleton-stat compact">

      <div className="hero-networth-skeleton-stat-value small skeleton"></div>

      <div className="hero-networth-skeleton-stat-label skeleton"></div>

    </div>

  </div>

);

const StakingCard = ({ name, value, type, delay }) => (

  <div

    className="card staking-card"

    style={{ animationDelay: `${delay}ms` }}

  >

    <div className="icon-square"></div>

    <div className="staking-info">

      <span className="staking-name">{name}</span>

      <span className="staking-value" style={{ fontSize: '14px', opacity: 0.8 }}>{type}: {value}</span>

    </div>

  </div>

);

const DeFiPositionCard = ({ protocolPositions, delay, priceMap, convertUSD, formatCurrencyValue, currencySymbol, language }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const firstPos = protocolPositions[0];
  const getProtocolKey = () => {
    const searchText = `${firstPos.name} ${firstPos.protocolName || ''} ${firstPos.resourceType || ''}`.toLowerCase();
    for (const key of Object.keys(DEFI_PROTOCOL_VISUALS)) {
      if (searchText.includes(key)) return key;
    }
    return null;
  };

  const protocolKey = getProtocolKey();
  const protocol = protocolKey
    ? DEFI_PROTOCOL_VISUALS[protocolKey]
    : { ...DEFAULT_PROTOCOL_VISUAL, name: firstPos.protocolName || DEFAULT_PROTOCOL_VISUAL.name };

  const supplyPositions = protocolPositions.filter(p => p.type === 'Lending' || p.type === 'Staking' || p.type === 'Liquidity');
  const debtPositions = protocolPositions.filter(p => p.type === 'Debt');

  const formatValue = (val) => {
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  const formatUsdValue = (val) => {
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return formatCurrencyValue(0);
    const converted = convertUSD(num);
    if (converted >= 1000000) return `${currencySymbol}${(converted / 1000000).toFixed(2)}M`;
    if (converted >= 1000) return `${currencySymbol}${(converted / 1000).toFixed(2)}K`;
    if (converted < 0.01) return formatCurrencyValue(converted, undefined, 4);
    return formatCurrencyValue(converted);
  };

  const getPositionUsdValue = (pos) => {
    return getDeFiPositionUsdValue(pos, priceMap) ?? 0;
  };

  const isMovementNativeStaking = (pos) => {
    const protocolName = String(pos?.protocolName || "").toLowerCase();
    const name = String(pos?.name || "").toLowerCase();
    const source = String(pos?.source || "").toLowerCase();

    return (
      protocolName.includes("movement native staking") ||
      name.includes("movement native staking") ||
      source === "view"
    );
  };

  const formatNativeStakingMeta = (pos) => {
    if (!isMovementNativeStaking(pos)) return null;

    const pool = String(pos?.poolAddress || "").toLowerCase();
    const poolSuffix = pool.startsWith("0x") && pool.length > 10 ? `...${pool.slice(-6)}` : null;

    const pendingStakeRaw = Number(pos?.pendingStakeAmount || 0);
    const pendingWithdrawalRaw = Number(pos?.pendingWithdrawalAmount || 0);
    const pendingMove = (pendingStakeRaw + pendingWithdrawalRaw) / 100000000;

    const poolPart = poolSuffix ? `Pool ${poolSuffix}` : null;
    const pendingPart = pendingMove > 0 ? `Pending ${formatValue(pendingMove)} MOVE` : null;

    if (poolPart && pendingPart) return `${poolPart} - ${pendingPart}`;
    return poolPart || pendingPart;
  };

  const totalSupplyUsd = supplyPositions.reduce((sum, p) => sum + getPositionUsdValue(p), 0);
  const totalDebtUsd = debtPositions.reduce((sum, p) => sum + getPositionUsdValue(p), 0);
  const netUsd = totalSupplyUsd - totalDebtUsd;
  const positionTypeLabel = supplyPositions.length > 0 && debtPositions.length > 0
    ? `${t(language, 'dashSupplied')} & ${t(language, 'dashBorrowed')}`
    : supplyPositions.length > 0 ? t(language, 'dashSupplied') : t(language, 'dashBorrowed');

  return (
    <div
      className={`defi-card-v2 ${isExpanded ? 'is-expanded' : 'is-compact'}`}
      style={{ animationDelay: `${delay}ms`, '--protocol-color': protocol.color }}
    >
      <div className="defi-v2-header">
        <div className="defi-v2-logo">
          <img
            src={protocol.logo}
            alt={protocol.name}
            onError={(e) => { e.target.onerror = null; e.target.src = '/movement-logo.svg'; }}
          />
        </div>
        <div className="defi-v2-title">
          <h3>{protocol.name}</h3>
          {isExpanded && (
            <span className="defi-v2-type">{positionTypeLabel}</span>
          )}
        </div>
        <div className="defi-v2-actions">
          <button
            type="button"
            className="defi-v2-toggle"
            onClick={() => setIsExpanded((current) => !current)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `Collapse ${protocol.name} details` : `Open full view for ${protocol.name}`}
            title={isExpanded ? 'Minimize' : 'Full view'}
          >
            {isExpanded ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 15 3 21" />
                <path d="M15 9 21 3" />
                <path d="M3 16v5h5" />
                <path d="M16 3h5v5" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6" />
                <path d="M9 21H3v-6" />
                <path d="M21 3 14 10" />
                <path d="M3 21 10 14" />
              </svg>
            )}
          </button>
          {firstPos.protocolWebsite && (
            <a href={firstPos.protocolWebsite} target="_blank" rel="noopener noreferrer" className="defi-v2-link" aria-label={`Open ${protocol.name} website`} title="Open protocol website">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
      </div>

      {!isExpanded ? (
        <div className="defi-v2-compact-body">
          <div className="defi-v2-net">
            <span className="defi-v2-net-label">{t(language, 'dashNetPosition')}</span>
            <span className={`defi-v2-net-value ${netUsd >= 0 ? 'positive' : 'negative'}`}>
              {netUsd >= 0 ? '+' : ''}{formatUsdValue(netUsd)}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="defi-v2-columns">
            <div className="defi-v2-column supply">
              <div className="defi-v2-column-header">
                <span className="defi-v2-column-label">{t(language, 'dashSupplied')}</span>
                <span className="defi-v2-column-total">{formatUsdValue(totalSupplyUsd)}</span>
              </div>
              <div className="defi-v2-column-items">
                {supplyPositions.length > 0 ? supplyPositions.map((pos, idx) => (
                  <div key={idx} className="defi-v2-item">
                    <div className="defi-v2-item-token-wrap">
                      <span className="defi-v2-item-token">{pos.tokenSymbol || 'Token'}</span>
                      {formatNativeStakingMeta(pos) && (
                        <span className="defi-v2-item-meta">{formatNativeStakingMeta(pos)}</span>
                      )}
                    </div>
                    <div className="defi-v2-item-values">
                      <span className="defi-v2-item-amount supply">{formatValue(pos.value)}</span>
                      <span className="defi-v2-item-usd">{formatUsdValue(getPositionUsdValue(pos))}</span>
                    </div>
                  </div>
                )) : (
                  <div className="defi-v2-empty">{t(language, 'dashNoSupply')}</div>
                )}
              </div>
            </div>

            <div className="defi-v2-column borrow">
              <div className="defi-v2-column-header">
                <span className="defi-v2-column-label">{t(language, 'dashBorrowed')}</span>
                <span className="defi-v2-column-total debt">{formatUsdValue(totalDebtUsd)}</span>
              </div>
              <div className="defi-v2-column-items">
                {debtPositions.length > 0 ? debtPositions.map((pos, idx) => (
                  <div key={idx} className="defi-v2-item">
                    <span className="defi-v2-item-token">{pos.tokenSymbol || 'Token'}</span>
                    <div className="defi-v2-item-values">
                      <span className="defi-v2-item-amount debt">-{formatValue(pos.value)}</span>
                      <span className="defi-v2-item-usd debt">-{formatUsdValue(getPositionUsdValue(pos))}</span>
                    </div>
                  </div>
                )) : (
                  <div className="defi-v2-empty">{t(language, 'dashNoDebt')}</div>
                )}
              </div>
            </div>
          </div>

          <div className="defi-v2-footer">
            <div className="defi-v2-net">
              <span className="defi-v2-net-label">{t(language, 'dashNetPosition')}</span>
              <span className={`defi-v2-net-value ${netUsd >= 0 ? 'positive' : 'negative'}`}>
                {netUsd >= 0 ? '+' : ''}{formatUsdValue(netUsd)}
              </span>
            </div>
            {debtPositions.length > 0 && totalSupplyUsd > 0 && (
              <div className="defi-v2-health">
                <span className="defi-v2-health-label">{t(language, 'dashHealth')}</span>
                <div className="defi-v2-health-bar">
                  <div
                    className="defi-v2-health-fill"
                    style={{
                      width: `${Math.min(100, Math.max(10, 100 - (totalDebtUsd / totalSupplyUsd) * 100))}%`,
                      background: protocol.gradient
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const humanizeAssetName = (raw) => {
  if (!raw || typeof raw !== 'string') return raw || 'Unknown';

  const FRIENDLY_NAMES = {
    'MERIDIAN_LP': 'Meridian LP Token',
    'MER-LP': 'Meridian LP Token',
    'MERIDIAN_POOL': 'Meridian Pool',
    'CANOPY_STAKING': 'Canopy Staking',
    'CANOPY_LP': 'Canopy LP',
    'YUZU_LP': 'Yuzu LP Token',
    'YUZ-LP': 'Yuzu LP Token',
    'MOVEMENT_STAKING': 'Movement Staking',
    'NATIVE_STAKING': 'Native Staking',
  };

  const upperRaw = raw.toUpperCase().trim();
  if (FRIENDLY_NAMES[upperRaw]) return FRIENDLY_NAMES[upperRaw];

  // Convert snake_case / SCREAMING_SNAKE to Title Case
  if (raw.includes('_') || raw === raw.toUpperCase()) {
    return raw
      .split(/[_-]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  return raw;
};

const LiquidityCard = ({ position, delay, priceMap, convertUSD, formatCurrencyValue, currencySymbol, language }) => {
  const LP_PROTOCOLS = {
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

  const LP_TOKEN_COLORS = {
    MOVE: '#cda169',
    USDC: '#2775ca',
    USDT: '#26a17b',
    ETH: '#627eea',
    WETH: '#627eea',
    BTC: '#f7931a',
    WBTC: '#f7931a',
    CAPY: '#ff6b9d',
    MOVECAT: '#9b59b6',
    LBTC: '#f7931a',
    EZETH: '#00d395',
    RSETH: '#4caf50',
    SOLVBTC: '#f7931a',
    USDE: '#171717',
    USDA: '#2196f3',
    WEETH: '#7c3aed',
  };

  const getTokenTextColor = (rawSymbol) => {
    if (!rawSymbol) return null;
    const normalized = rawSymbol
      .toString()
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, '');

    const withoutSuffix = normalized.replace(/\.E$/i, '');
    const withoutCvPrefix = withoutSuffix.replace(/^CV/, '');
    const withoutLPrefix = withoutCvPrefix.replace(/^L/, '');

    return (
      LP_TOKEN_COLORS[withoutLPrefix] ||
      LP_TOKEN_COLORS[withoutCvPrefix] ||
      LP_TOKEN_COLORS[withoutSuffix] ||
      LP_TOKEN_COLORS[normalized] ||
      null
    );
  };

  const renderColoredTokenText = (value) => {
    if (typeof value !== 'string' || !value) return value;

    const pieces = value.split(/(\s+|\/|\+|,|:|\(|\))/g).filter((piece) => piece !== '');
    const NON_TOKEN_WORDS = new Set(['LP', 'TOKEN', 'POSITION', 'NOT', 'AVAILABLE', 'ASSET']);

    return pieces.map((piece, index) => {
      const trimmed = piece.trim();
      if (!trimmed) return <React.Fragment key={`lp-txt-${index}`}>{piece}</React.Fragment>;

      const normalized = trimmed.replace(/[^A-Za-z0-9.]/g, '');
      const hasLetters = /[A-Za-z]/.test(normalized);
      if (!hasLetters) return <React.Fragment key={`lp-txt-${index}`}>{piece}</React.Fragment>;

      const upper = normalized.toUpperCase();
      if (NON_TOKEN_WORDS.has(upper)) return <React.Fragment key={`lp-txt-${index}`}>{piece}</React.Fragment>;

      const color = getTokenTextColor(upper);
      if (!color) return <React.Fragment key={`lp-txt-${index}`}>{piece}</React.Fragment>;

      return (
        <span key={`lp-txt-${index}`} className="lp-token-colored" style={{ color }}>
          {piece}
        </span>
      );
    });
  };

  const isCanopyDeposit = position.protocol === 'canopy' ||
    position.symbol?.startsWith('cv') ||
    position.symbol?.includes('stMOVE');

  const formatValue = (val) => {
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  const formatUsd = (val) => {
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return formatCurrencyValue(0);
    const converted = convertUSD(num);
    if (converted >= 1000000) return `${currencySymbol}${(converted / 1000000).toFixed(2)}M`;
    if (converted >= 1000) return `${currencySymbol}${(converted / 1000).toFixed(2)}K`;
    if (converted > 0 && converted < 0.01) return `< ${currencySymbol}0.01`;
    if (converted < 1) return formatCurrencyValue(converted, undefined, 4);
    return formatCurrencyValue(converted);
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
      if (position.usdValue && position.usdValue > 0) {
        return position.usdValue;
      }
      if (position.liquidityValue) {
        return position.liquidityValue;
      }
      return 0;
    }

    if (position.isMeridianLP) {
      return 0;
    }

    if (position.symbol?.includes('cvMOVE') || position.symbol?.includes('stMOVE') ||
      position.symbol?.includes('MOVE') && position.protocol === 'canopy') {
      const movePrice = priceMap['0xa'] || priceMap['0x1'] || 0;
      return amount * movePrice;
    }

    if (position.symbol?.includes('cvWBTC') || position.symbol?.includes('WBTC') || position.symbol?.includes('BTC')) {
      const btcPrice = Object.entries(priceMap).find(([addr]) =>
        addr.toLowerCase().includes('wbtc') || addr.toLowerCase().includes('btc')
      )?.[1] || 95000;
      return amount * btcPrice;
    }

    if (position.symbol?.includes('cvWETH') || position.symbol?.includes('WETH') || position.symbol?.includes('ETH')) {
      const ethPrice = Object.entries(priceMap).find(([addr]) =>
        addr.toLowerCase().includes('weth') || addr.toLowerCase().includes('eth')
      )?.[1] || 3500;
      return amount * ethPrice;
    }

    if (position.symbol?.includes('lMOVE')) {
      const movePrice = priceMap['0xa'] || priceMap['0x1'] || 0;
      return amount * movePrice;
    }

    if (position.protocol === 'meridian' && position.symbol?.includes('MER-LP')) {
      return 0;
    }

    if (position.symbol?.includes('USDC') || position.symbol?.includes('USDT') ||
      position.underlying?.includes('USDC') || position.underlying?.includes('USDT')) {
      return amount;
    }

    return position.usdValue || 0;
  };

  const usdValue = getUnderlyingValue();
  const meridianPoolLabel = position.protocol === 'meridian'
    ? (
      Array.isArray(position.poolTokens) && position.poolTokens.length > 0
        ? position.poolTokens.map((token) => token.symbol).join(' / ')
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
    detailLabel = t(language, 'dashTokenComposition');
    detailValue = position.poolTokens
      .map((token) => `${formatValue(token.amount)} ${token.symbol || 'Token'}`)
      .join(' + ');
  } else if (
    position.protocol === 'meridian' &&
    (!Array.isArray(position.poolTokens) || position.poolTokens.length === 0) &&
    (position.liquidityX > 0 || position.liquidityY > 0)
  ) {
    detailLabel = 'Token Composition';
    detailValue = `${position.liquidityX > 0 ? `${formatValue(position.liquidityX / 1000000)} ${position.tokenX || 'Token X'}` : ''}${position.liquidityX > 0 && position.liquidityY > 0 ? ' + ' : ''}${position.liquidityY > 0 ? `${formatValue(position.liquidityY / 1000000)} ${position.tokenY || 'Token Y'}` : ''}`;
  }

  const isLongDetailValue = detailLabel === 'Token Amounts' || detailLabel === 'Token Composition';
  const colorizePrimaryValue = isPoolStylePrimary;
  const colorizeDetailValue = detailLabel === 'Token Amounts' || detailLabel === 'Token Composition' || detailLabel === 'Underlying';
  const colorizeSecondaryValue = secondaryLabel === 'Underlying Asset';

  return (
    <div
      className="lp-card"
      style={{
        animationDelay: `${delay}ms`,
        '--lp-color': protocol.color
      }}
    >
      <div className="lp-card-header">
        <div className="lp-card-logo">
          <img
            src={protocol.logo}
            alt={protocol.name}
            onError={(e) => { e.target.onerror = null; e.target.src = '/movement-logo.svg'; }}
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

      <div className="lp-card-body">
        <div className="lp-card-stats-row">
          <div className="lp-card-stat">
            <span className="lp-card-stat-label">{primaryLabel}</span>
            <span className={`lp-card-stat-value ${isPoolStylePrimary ? 'text' : ''}`} title={primaryValue}>
              {colorizePrimaryValue ? renderColoredTokenText(primaryValue) : primaryValue}
            </span>
          </div>
          <div className="lp-card-stat">
            <span className="lp-card-stat-label">Liquidity</span>
            <span className={`lp-card-stat-value highlight ${usdValue > 0 ? '' : 'na'}`}>
              {usdValue > 0 ? formatUsd(usdValue) : 'Price N/A'}
            </span>
          </div>
        </div>

        <div className="lp-card-details">
          <div className={`lp-card-detail-row ${isLongDetailValue ? 'long' : ''}`}>
            <span className="lp-card-stat-label">{detailLabel}</span>
            <span className={`lp-card-stat-value small ${detailValue === 'Not available' ? 'muted' : ''} ${isLongDetailValue ? 'wrap' : ''}`} title={detailValue}>
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

const ErrorMessage = ({ message, onRetry }) => (
  <div className="error-message">
    <p>{message}</p>
    {onRetry && <button onClick={onRetry} className="retry-btn">Retry</button>}

  </div>

);

const RouteFallback = () => (
  <div className="loading-indicator">Loading...</div>
);

const Dashboard = () => {

  const { account, connected } = useWallet();
  const navigate = useNavigate();
  const location = useLocation();
  const { address: urlAddress } = useParams();

  const [balances, setBalances] = useState([]);
  const [language, setLanguage] = useState(() => getStoredLanguagePreference());

  const [assetsLoading, setAssetsLoading] = useState(false);

  const [error, setError] = useState(null);

  const [totalUsdValue, setTotalUsdValue] = useState(0);

  const [viewingAddress, setViewingAddress] = useState(null);
  const [activeTab, setActiveTab] = useState(PORTFOLIO_TABS.OVERVIEW);

  const [walletAge, setWalletAge] = useState(null);
  const [liquidityPositions, setLiquidityPositions] = useState([]);
  const [lpLoading, setLpLoading] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [hidePositionThreshold, setHidePositionThreshold] = useState(0);
  const meridianPoolInfoCacheRef = useRef(new Map());
  const yuzuDiscoveryCacheRef = useRef(new Map());

  const settingsKey = useMemo(() => getSettingsStorageKey(account?.address), [account?.address]);

  const { convertUSD, formatValue: formatCurrencyValue, currencySymbol } = useCurrency();

  useEffect(() => {
    const syncHidePositionThreshold = () => {
      setHidePositionThreshold(getStoredHidePositionThreshold(settingsKey));
    };

    syncHidePositionThreshold();

    const onStorage = (event) => {
      if (!event?.key || event.key === 'settings_global' || event.key === settingsKey) {
        syncHidePositionThreshold();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [settingsKey]);

  const {
    balances: indexerBalances,
    loading: indexerLoading,
    error: indexerError,
  } = useIndexerBalances(viewingAddress);

  const {
    positions,
    loading: defiLoading
  } = useDeFiPositions(viewingAddress);
  const { prices: priceMap, priceChanges } = useTokenPrices();

  // Legacy Memos for Filtering
  const visibleDeFiPositions = useMemo(() => {
    if (!Array.isArray(positions) || positions.length === 0) return [];

    return positions.filter((pos) => {
      const protocolName = String(pos?.protocolName || "").toLowerCase();
      // Meridian is handled specifically in the LP/Liquidity discovery below
      if (protocolName === "meridian") return false;

      return shouldDisplayPosition(getDeFiPositionUsdValue(pos, priceMap), hidePositionThreshold);
    });
  }, [hidePositionThreshold, positions, priceMap]);

  const visibleLiquidityPositions = useMemo(() => {
    if (!Array.isArray(liquidityPositions)) return [];
    return liquidityPositions.filter(pos =>
      shouldDisplayPosition(getLiquidityPositionUsdValue(pos, priceMap), hidePositionThreshold)
    );
  }, [liquidityPositions, priceMap, hidePositionThreshold]);

  const { profile: userProfile } = useProfile(viewingAddress);
  const { level: viewingLevel } = useUserLevel(viewingAddress);

  const modalProfileAddress = showProfileModal ? viewingAddress : null;
  const { level, xp, nextLevelXP, xpProgress, badges: userBadges, loading: levelLoading } = useUserLevel(modalProfileAddress);
  const userAvatarSrc = getLevelBasedPfp({
    level: viewingLevel,
    address: viewingAddress,
    preferredPfp: userProfile?.avatar_url || userProfile?.pfp,
  });
  const modalAvatarSrc = getLevelBasedPfp({
    level,
    address: viewingAddress,
    preferredPfp: userProfile?.avatar_url || userProfile?.pfp,
  });

  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getStoredLanguagePreference());
    };

    const onLanguageChange = (event) => {
      const nextLanguage = event?.detail?.language;
      if (nextLanguage) {
        setLanguage(nextLanguage);
      } else {
        syncLanguage();
      }
    };

    window.addEventListener('languagechange', onLanguageChange);
    window.addEventListener('storage', syncLanguage);
    return () => {
      window.removeEventListener('languagechange', onLanguageChange);
      window.removeEventListener('storage', syncLanguage);
    };
  }, []);

  useEffect(() => {
    if (urlAddress && isValidAddress(urlAddress)) {
      setViewingAddress(urlAddress);
    } else if (!urlAddress && !connected) {
      setViewingAddress(null);
    }
  }, [urlAddress, connected]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const addressParam = params.get('address');
    if (addressParam && isValidAddress(addressParam)) {
      navigate(`/profile/${addressParam}`, { replace: true });
    }
  }, [location.search, navigate]);

  const currentNetwork = DEFAULT_NETWORK;
  const { client: movementClient, loading: movementClientLoading } = useMovementClient(currentNetwork.rpc);


  const modalBadgeAddress = modalProfileAddress;
  const { badges: onchainBadges, loading: onchainBadgesLoading } = useBadges(modalBadgeAddress, {
    client: movementClient,
    clientLoading: movementClientLoading,
    enablePolling: false,
  });
  const { earnedBadges: persistedBadges } = useUserBadges(modalBadgeAddress);
  const defiNetValue = useMemo(() => {
    if (!visibleDeFiPositions || visibleDeFiPositions.length === 0 || !priceMap) return 0;

    let totalSupply = 0;
    let totalDebt = 0;

    visibleDeFiPositions.forEach(pos => {
      const usdVal = getDeFiPositionUsdValue(pos, priceMap) ?? 0;
      // If it's a debt/borrow type, subtract it
      if (pos.type === 'Debt') {
        totalDebt += usdVal;
      } else {
        totalSupply += usdVal;
      }
    });
    return totalSupply - totalDebt;
  }, [visibleDeFiPositions, priceMap]);
  const liquidityTotalValue = useMemo(() => {
    if (!liquidityPositions || liquidityPositions.length === 0) return 0;

    return liquidityPositions.reduce((total, position) => {
      const value = getLiquidityPositionUsdValue(position, priceMap) ?? 0;
      return total + value;
    }, 0);
  }, [priceMap, liquidityPositions]);
  const combinedNetWorth = useMemo(() => {
    // Ensure all values are numeric and handle undefined/null
    const wallet = Number(totalUsdValue) || 0;
    const defi = Number(defiNetValue) || 0;
    const liquidity = Number(liquidityTotalValue) || 0;
    return wallet + defi + liquidity;
  }, [totalUsdValue, defiNetValue, liquidityTotalValue]);
  const portfolio24hChange = useMemo(() => {
    if (!balances || balances.length === 0 || !priceChanges || combinedNetWorth === 0) {
      return null;
    }
    let weightedChange = 0;
    let totalWeight = 0;

    balances.forEach(token => {
      const address = token.address;
      const usdValue = token.usdValue || 0;
      const change = priceChanges[address];

      if (change !== undefined && usdValue > 0) {
        weightedChange += change * usdValue;
        totalWeight += usdValue;
      }
    });
    if (totalWeight > 0) {
      return weightedChange / totalWeight;
    }

    return null;
  }, [balances, priceChanges, combinedNetWorth]);

  const toRawCoinString = useCallback((value) => {
    if (value === null || value === undefined) return null;

    if (typeof value === "bigint") {
      return value > 0n ? value.toString() : null;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) return null;
      return Number.isInteger(value) ? String(value) : String(Math.trunc(value));
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return /^\d+$/.test(trimmed) && trimmed !== "0" ? trimmed : null;
    }

    if (typeof value === "object") {
      return (
        toRawCoinString(value.value) ||
        toRawCoinString(value.amount) ||
        toRawCoinString(value.balance) ||
        toRawCoinString(value.coin)
      );
    }

    return null;
  }, []);

  const extractRawCoinValue = useCallback((coinData) => {
    if (!coinData) return null;

    const direct =
      toRawCoinString(coinData?.coin?.value) ||
      toRawCoinString(coinData?.coin?.amount) ||
      toRawCoinString(coinData?.coin) ||
      toRawCoinString(coinData?.value) ||
      toRawCoinString(coinData?.amount) ||
      toRawCoinString(coinData?.balance);

    if (direct) return direct;

    const queue = [];
    if (coinData?.coin && typeof coinData.coin === "object") {
      queue.push(coinData.coin);
    }
    queue.push(coinData);

    const seen = new Set();
    const primaryKeys = ["value", "amount", "balance", "coin", "liquidity", "staked", "deposited"];
    const relevantKeyRegex = /(coin|amount|balance|value|liquidity|staked|deposit|share|stake)/i;

    while (queue.length > 0) {
      const current = queue.shift();

      if (!current || typeof current !== "object") {
        const primitiveCandidate = toRawCoinString(current);
        if (primitiveCandidate) return primitiveCandidate;
        continue;
      }

      if (seen.has(current)) continue;
      seen.add(current);

      if (Array.isArray(current)) {
        for (const item of current) {
          const candidate = toRawCoinString(item);
          if (candidate) return candidate;
          if (item && typeof item === "object") queue.push(item);
        }
        continue;
      }

      for (const key of primaryKeys) {
        if (current[key] !== undefined) {
          const candidate = toRawCoinString(current[key]);
          if (candidate) return candidate;
        }
      }

      const prioritized = [];
      const secondary = [];
      for (const [key, value] of Object.entries(current)) {
        if (!value || typeof value !== "object") continue;
        if (relevantKeyRegex.test(key)) {
          prioritized.push(value);
        } else {
          secondary.push(value);
        }
      }

      queue.unshift(...prioritized);
      queue.push(...secondary);
    }

    return null;
  }, [toRawCoinString]);

  const fetchMeridianPoolInfo = useCallback(async (poolAddress) => {
    if (!poolAddress || typeof poolAddress !== 'string') return null;

    try {
      const normalizeAssetIdentifier = (value) => {
        if (!value) return '';

        let normalized = String(value).trim().toLowerCase();
        const genericMatch = normalized.match(/<\s*([^>]+)\s*>/);
        if (genericMatch?.[1]) {
          normalized = genericMatch[1].trim().toLowerCase();
        }

        if (normalized.includes('::')) {
          normalized = normalized.split('::')[0];
        }

        if (normalized.startsWith('0x')) {
          const compact = normalized.slice(2).replace(/^0+/, '') || '0';
          normalized = `0x${compact}`;
        }

        return normalized;
      };

      const buildAssetAliases = (value) => {
        const aliases = new Set();
        const normalized = normalizeAssetIdentifier(value);
        if (!normalized) return aliases;

        aliases.add(normalized);

        if (normalized === '0x1' || normalized === '0xa') {
          aliases.add('0x1');
          aliases.add('0xa');
        }

        return aliases;
      };

      const normalizedPool = poolAddress.trim().toLowerCase();
      if (!movementClient) return null;
      const resources = await movementClient.getAccountResources({ accountAddress: normalizedPool });

      const poolResource = resources.find((resource) => resource.type.includes('::pool::Pool'));
      const supplyResource = resources.find((resource) => resource.type === '0x1::fungible_asset::ConcurrentSupply');

      if (!poolResource || !supplyResource?.data?.current?.value) return null;

      const poolAssets = Array.isArray(poolResource.data?.assets_metadata)
        ? poolResource.data.assets_metadata
          .map((asset) => {
            if (typeof asset === 'string') return asset;
            if (asset?.inner) return asset.inner;
            if (asset?.value) return asset.value;
            if (asset?.metadata) return asset.metadata;
            return null;
          })
          .map((asset) => normalizeAssetIdentifier(asset))
          .filter(Boolean)
        : [];

      if (!poolAssets.length) return null;

      const poolBalances = await getUserTokenBalances(normalizedPool);
      const poolAssetAliasSet = new Set(
        poolAssets.flatMap((asset) => Array.from(buildAssetAliases(asset)))
      );

      const filteredReserves = poolBalances.filter((item) => {
        const itemAssetType = item?.asset_type;
        const aliases = buildAssetAliases(itemAssetType);
        if (!aliases.size) return false;

        for (const alias of aliases) {
          if (poolAssetAliasSet.has(alias)) {
            return true;
          }
        }

        return false;
      });

      const fallbackReserves = poolBalances
        .filter((item) => Number(item?.amount || 0) > 0)
        .filter((item) => !/MER-LP|LP TOKEN|LPCOIN/i.test(String(item?.metadata?.symbol || '')))
        .sort((a, b) => Number(b?.amount || 0) - Number(a?.amount || 0));

      const candidateReserves = filteredReserves.length >= 2
        ? filteredReserves
        : fallbackReserves.slice(0, 2);

      if (!candidateReserves.length) return null;

      const reserveByAsset = new Map();
      candidateReserves.forEach((item) => {
        const key = normalizeAssetIdentifier(item?.asset_type) || String(item?.asset_type || '').toLowerCase();
        const amount = Number(item?.amount || 0);
        const existing = reserveByAsset.get(key);
        if (!existing || amount > Number(existing?.amount || 0)) {
          reserveByAsset.set(key, item);
        }
      });

      const reserves = Array.from(reserveByAsset.values());

      const tokens = reserves.map((item) => {
        const decimals = Number(item?.metadata?.decimals ?? 8);
        const rawAmount = Number(item?.amount || 0);
        const amount = rawAmount / Math.pow(10, decimals);

        return {
          assetType: String(item?.asset_type || '').toLowerCase(),
          symbol: item?.metadata?.symbol || 'Token',
          decimals,
          rawAmount,
          amount,
        };
      });

      const totalSupplyRaw = Number(supplyResource.data.current.value || 0);
      if (!totalSupplyRaw || totalSupplyRaw <= 0) return null;

      return {
        poolId: normalizedPool,
        totalSupplyRaw,
        tokens,
      };
    } catch {
      return null;
    }
  }, [movementClient]);

  const getCachedMeridianPoolInfo = useCallback(async (poolAddress) => {
    if (!poolAddress || typeof poolAddress !== 'string') return null;

    const normalizedPoolAddress = poolAddress.trim().toLowerCase();
    const now = Date.now();
    const cacheEntry = meridianPoolInfoCacheRef.current.get(normalizedPoolAddress);

    if (cacheEntry?.value && (now - cacheEntry.cachedAt) < LP_DISCOVERY_CACHE_TTL_MS) {
      return cacheEntry.value;
    }

    if (cacheEntry?.promise) {
      return cacheEntry.promise;
    }

    const promise = fetchMeridianPoolInfo(normalizedPoolAddress)
      .then((value) => {
        meridianPoolInfoCacheRef.current.set(normalizedPoolAddress, {
          value,
          cachedAt: Date.now(),
        });
        return value;
      })
      .catch((error) => {
        meridianPoolInfoCacheRef.current.delete(normalizedPoolAddress);
        throw error;
      });

    meridianPoolInfoCacheRef.current.set(normalizedPoolAddress, {
      promise,
      cachedAt: now,
    });

    return promise;
  }, [fetchMeridianPoolInfo]);

  const getCachedYuzuDiscovery = useCallback(async (address) => {
    if (!address || typeof address !== 'string') {
      return {
        nftHoldings: [],
        yuzuEvents: [],
      };
    }

    const normalizedAddress = address.trim().toLowerCase();
    const now = Date.now();
    const cacheEntry = yuzuDiscoveryCacheRef.current.get(normalizedAddress);

    if (cacheEntry?.value && (now - cacheEntry.cachedAt) < LP_DISCOVERY_CACHE_TTL_MS) {
      return cacheEntry.value;
    }

    if (cacheEntry?.promise) {
      return cacheEntry.promise;
    }

    const promise = Promise.all([
      getUserNFTHoldings(normalizedAddress),
      getYuzuLiquidityPositions(normalizedAddress),
    ]).then(([nftHoldings, yuzuEvents]) => {
      const value = { nftHoldings, yuzuEvents };
      yuzuDiscoveryCacheRef.current.set(normalizedAddress, {
        value,
        cachedAt: Date.now(),
      });
      return value;
    }).catch((error) => {
      yuzuDiscoveryCacheRef.current.delete(normalizedAddress);
      throw error;
    });

    yuzuDiscoveryCacheRef.current.set(normalizedAddress, {
      promise,
      cachedAt: now,
    });

    return promise;
  }, []);
  const fetchAssets = useCallback(async (address) => {
    if (!address) {
      setBalances([]);
      setTotalUsdValue(0);
      return;
    }

    setAssetsLoading(true);
    setError(null);

    try {
      let normalizedAddress;
      if (typeof address === "string") {
        normalizedAddress = address.trim();
      } else if (address && typeof address === "object") {
        if (address.toString) {
          normalizedAddress = address.toString();
        } else if (address.hex) {
          normalizedAddress = address.hex();
        } else if (address.data && typeof address.data === "object") {
          const hex = Array.from(address.data)
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
          normalizedAddress = `0x${hex}`;
        } else {
          normalizedAddress = String(address);
        }
        normalizedAddress = normalizedAddress.trim();
      } else {
        normalizedAddress = String(address).trim();
      }

      devLog("Fetching assets for address:", normalizedAddress);
      devLog("Original address type:", typeof address, address);
      devLog("Using RPC endpoint:", currentNetwork.rpc);
      if (!movementClient) {
        return;
      }
      const resources = await movementClient.getAccountResources({
        accountAddress: normalizedAddress
      });

      devLog("=== BALANCE DEBUG ===");
      devLog("Normalized address:", normalizedAddress);
      devLog("RPC endpoint:", currentNetwork.rpc);
      devLog("RPC Resources fetched:", resources.length);
      devLog("All resource types:", resources.map(r => r.type).join("\n"));
      devLog("=== END DEBUG ===");
      const coinResources = resources.filter((r) =>
        r.type.includes("CoinStore") && r.type.includes("<")
      );

      devLog("Coin resources found:", coinResources.length);
      if (coinResources.length === 0) {
        console.warn("ERROR NO COINSTORES FOUND!");
        console.warn("All resource types returned from RPC:");
        resources.forEach((r, idx) => {
          devLog(`  ${idx + 1}. ${r.type}`);
        });
        console.warn("This means either:");
        console.warn("  1. The RPC endpoint isn't returning coin resources");
        console.warn("  2. The wallet address is incorrect");
        console.warn("  3. The wallet has no tokens on this network");
        console.warn("  4. The wallet was just created and not indexed yet");
        const potentialTokenResources = resources.filter(r =>
          r.type.includes("CoinStore") ||
          r.type.includes("coin") ||
          r.type.includes("Coin") ||
          r.type.includes("token") ||
          r.type.includes("Token")
        );

        if (potentialTokenResources.length > 0) {
          devLog("Found potential token-related resources:", potentialTokenResources.map(r => ({
            type: r.type,
            hasData: !!r.data,
            dataKeys: r.data ? Object.keys(r.data) : []
          })));
          const coinStoreResources = potentialTokenResources.filter(r => r.type.includes("CoinStore"));
          if (coinStoreResources.length > 0) {
            devLog("Warning: Found CoinStore resources that should be processed:", coinStoreResources.map(r => ({
              type: r.type,
              data: r.data
            })));
          }
        }
      }
      if (coinResources.length > 0) {
        devLog("Sample coin resource:", {
          type: coinResources[0].type,
          data: coinResources[0].data,
          dataKeys: coinResources[0].data ? Object.keys(coinResources[0].data) : []
        });
      }

      let processed = coinResources
        .map((coin) => {
          try {
            const tokenMeta = parseCoinType(coin.type);
            if (!tokenMeta) {
              console.warn("Could not parse coin type:", coin.type);
              return null;
            }

            const decimals = getTokenDecimals(coin.type, tokenMeta);
            let coinValue = extractRawCoinValue(coin.data) || "0";

            if ((!coinValue || coinValue === "0") && coin.data) {
              console.warn("Coin data structure:", {
                type: coin.type,
                data: coin.data,
                dataKeys: Object.keys(coin.data || {}),
                coinKeys: coin.data?.coin ? Object.keys(coin.data.coin) : null
              });
            }
            if (!coinValue || coinValue === "0" || coinValue === "undefined" || coinValue === "null") {
              console.warn("Could not extract coin value for:", coin.type);
              console.warn("Full coin data:", JSON.stringify(coin.data, null, 2));
              return null;
            }

            devLog(`Processing ${tokenMeta.symbol}: raw=${coinValue}, decimals=${decimals}`);

            const numericValue = BigInt(coinValue);
            const divisor = BigInt(10) ** BigInt(decimals);
            const quantity = Number(numericValue) / Number(divisor);

            if (quantity <= 0) {
              return null;
            }
            let price = 0;
            if (priceMap[tokenMeta.address]) {
              price = priceMap[tokenMeta.address];
            }
            else if (tokenMeta.symbol === "USDT" || tokenMeta.symbol === "USDC") {
              price = 1.0;
            }
            else {
              price = priceMap[tokenMeta.fullType] ?? 0;
            }

            const usdValue = quantity * price;
            const isHighValueToken = ['BTC', 'WBTC', 'ETH', 'WETH'].includes(tokenMeta.symbol);
            let formattedAmount;
            if (isHighValueToken && quantity < 0.01) {
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 8,
              });
            } else if (isHighValueToken && quantity < 1) {
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 6,
              });
            } else {
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              });
            }
            let formattedUsdValue;
            if (usdValue > 0 && usdValue < 0.01) {
              formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 6,
              })}`;
            } else if (usdValue > 0 && usdValue < 1) {
              formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}`;
            } else {
              formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`;
            }

            return {
              id: coin.type,
              fullType: tokenMeta.fullType,
              address: tokenMeta.address,
              name: tokenMeta.name,
              symbol: tokenMeta.symbol,
              amount: formattedAmount,
              price,
              usdValue,
              formattedValue: formattedUsdValue,
              numericAmount: quantity,
              isKnown: tokenMeta.isKnown || false,
            };
          } catch (e) {
            console.error("Error processing coin:", coin.type, e);
            return null;
          }
        })
        .filter(Boolean);
      processed = processed.filter((t) => t && t.isKnown);

      devLog("Processed verified tokens:", processed.length);
      processed.sort((a, b) => b.usdValue - a.usdValue);
      const totalUsd = processed.reduce((sum, token) => sum + token.usdValue, 0);

      devLog("Total USD value (verified):", totalUsd);

      setBalances(processed);
      setTotalUsdValue(totalUsd);
    } catch (fetchError) {
      console.error("Fetch Error Details:", {
        message: fetchError.message,
        stack: fetchError.stack,
        name: fetchError.name,
        address: address,
        rpc: currentNetwork.rpc
      });
      let errorMessage = "Failed to fetch assets.";
      if (fetchError.message?.includes("network") || fetchError.message?.includes("fetch")) {
        errorMessage = "Network error. Please check your connection and try again.";
      } else if (fetchError.message?.includes("404") || fetchError.message?.includes("not found")) {
        errorMessage = "Address not found or has no resources.";
      } else {
        errorMessage = `Error: ${fetchError.message || "Unknown error"}`;
      }

      setError(errorMessage);
      setBalances([]);
    } finally {
      setAssetsLoading(false);
    }
  }, [movementClient, priceMap, currentNetwork, extractRawCoinValue]);
  const getAddressString = (accountObj) => {
    if (!accountObj || !accountObj.address) return null;

    const addr = accountObj.address;
    if (typeof addr === "string") {
      return addr.trim();
    }
    if (addr && typeof addr === "object") {
      try {
        if (typeof addr.toString === "function" && addr.toString !== Object.prototype.toString) {
          const str = addr.toString();
          if (str && str.startsWith("0x")) {
            return str;
          }
        }
        if (typeof addr.hex === "function") {
          return addr.hex();
        }
        if (addr.data) {
          let dataArray;
          if (addr.data instanceof Uint8Array) {
            dataArray = Array.from(addr.data);
          } else if (Array.isArray(addr.data)) {
            dataArray = addr.data;
          }

          if (dataArray && dataArray.length > 0) {
            const hex = dataArray
              .map(b => {
                const num = typeof b === "number" ? b : parseInt(b, 10);
                return num.toString(16).padStart(2, "0");
              })
              .join("");
            return `0x${hex}`;
          }
        }
      } catch (e) {
        console.warn("Error converting address object:", e);
      }
    }
    const str = String(addr).trim();
    if (str && str !== "[object Object]") {
      return str;
    }

    return null;
  };

  const connectedWalletAddress = connected ? getAddressString(account) : null;
  const canEditProfile = Boolean(
    connectedWalletAddress &&
    viewingAddress &&
    connectedWalletAddress.toLowerCase() === viewingAddress.toLowerCase()
  );
  useEffect(() => {
    if (account && connected) {
      const addressString = getAddressString(account);
      devLog("=== WALLET CONNECTED ===");
      devLog("Extracted address string:", addressString);
      devLog("========================");

      if (addressString) {
        if (!urlAddress || urlAddress.toLowerCase() === addressString.toLowerCase()) {
          setViewingAddress(addressString);
          navigate(`/profile/${addressString}`, { replace: true });
          devLog("Address set, indexer will fetch balances");
        }
      } else {
        console.error("Could not extract address from account object:", account);
        setError("Could not extract wallet address. Please try reconnecting.");
      }
    } else if (!connected) {
      if (!urlAddress) {
        setViewingAddress(null);
        setBalances([]);
        setTotalUsdValue(0);
        navigate('/', { replace: true });
      }
    }
  }, [account, connected, navigate, urlAddress]);
  useEffect(() => {
    if (viewingAddress && (!account || viewingAddress !== account.address)) {
      devLog("Viewing searched address:", viewingAddress, "(indexer will fetch)");
    }
  }, [viewingAddress, account]);

  useEffect(() => {
    let cancelled = false;
    const detectLPPositions = async () => {
      setLpLoading(true);
      try {
        const lpPositions = [];
        if (indexerBalances && indexerBalances.length > 0) {
          const LP_PATTERNS = [
            { pattern: /cvMOVE|cvUSDC|cvUSDT|cvWBTC|cvWETH/i, protocol: 'canopy', underlying: 'MOVE' },
            { pattern: /stMOVE|StakedMove/i, protocol: 'canopy', underlying: 'MOVE' },
            { pattern: /MER-LP|Meridian LP/i, protocol: 'meridian', underlying: 'MERIDIAN_LP' },
            { pattern: /YuzuLP|Yuzu-LP/i, protocol: 'yuzu', underlying: 'LP' },
          ];
          let meridianCompositions = [];
          if (positions && positions.length > 0) {
            devLog('Meridian positions from hook:', positions.map(p => ({ id: p.id, protocolName: p.protocolName, type: p.type, liquidityX: p.liquidityX })));
            meridianCompositions = positions.filter(pos =>
              pos.protocolName === 'Meridian' &&
              (pos.liquidityX !== undefined || pos.liquidityY !== undefined || pos.liquidityTokens !== undefined || pos.stakedAmount !== undefined)
            );
            devLog('Meridian positions with composition:', meridianCompositions.length,
              meridianCompositions.map(p => ({ liquidityX: p.liquidityX, liquidityY: p.liquidityY, liquidityTokens: p.liquidityTokens, tokenX: p.tokenX, tokenY: p.tokenY })));
          }
          let meridianLPIndex = 0;

          const normalizeMeridianSymbol = (value) => {
            const symbol = String(value || '').trim().toUpperCase();
            if (!symbol) return '';
            if (symbol.includes('USDC')) return 'USDC';
            if (symbol.includes('USDT')) return 'USDT';
            if (symbol.includes('WBTC') || symbol === 'BTC') return 'WBTC';
            if (symbol.includes('WETH') || symbol === 'ETH') return 'WETH';
            if (symbol.includes('MOVE') && symbol.includes('DROP')) return 'MOVE_DROPS';
            if (symbol.includes('MOVE')) return 'MOVE';
            return symbol.replace(/[^A-Z0-9]/g, '');
          };

          const isMeridianPoolMatch = (tokenX, tokenY, poolTokens) => {
            if (!Array.isArray(poolTokens) || poolTokens.length === 0) return false;

            const expectedTokens = [tokenX, tokenY]
              .map((token) => normalizeMeridianSymbol(token))
              .filter(Boolean);

            if (expectedTokens.length === 0) return true;

            const poolTokenSet = new Set(
              poolTokens
                .map((token) => normalizeMeridianSymbol(token?.symbol))
                .filter(Boolean)
            );

            if (!poolTokenSet.size) return false;

            const matched = expectedTokens.filter((token) => poolTokenSet.has(token)).length;
            return matched >= Math.min(2, expectedTokens.length);
          };
          const meridianPoolInfoByAddress = {};
          const meridianPoolAddresses = Array.from(
            new Set(
              indexerBalances
                .filter((balance) => {
                  const symbol = balance.symbol || '';
                  const name = balance.name || '';
                  return /MER-LP|Meridian LP/i.test(symbol) || /MER-LP|Meridian LP/i.test(name);
                })
                .map((balance) => String(balance.address || balance.type || '').toLowerCase())
                .filter(Boolean)
            )
          );

          await Promise.all(
            meridianPoolAddresses.map(async (poolAddress) => {
              meridianPoolInfoByAddress[poolAddress] = await getCachedMeridianPoolInfo(poolAddress);
            })
          );

          indexerBalances.forEach(balance => {
            const symbol = balance.symbol || '';
            const name = balance.name || '';

            for (const { pattern, protocol, underlying } of LP_PATTERNS) {
              if (pattern.test(symbol) || pattern.test(name)) {
                let underlyingAsset = underlying;
                if (symbol.includes('USDC')) underlyingAsset = 'USDC.e';
                else if (symbol.includes('USDT')) underlyingAsset = 'USDT.e';
                else if (symbol.includes('WBTC') || symbol.includes('BTC')) underlyingAsset = 'WBTC.e';
                else if (symbol.includes('WETH') || symbol.includes('ETH')) underlyingAsset = 'WETH.e';
                else if (symbol.includes('MOVE') || symbol === 'lMOVE') underlyingAsset = 'MOVE';
                let usdValue = 0;
                const amount = balance.numericAmount || 0;

                if (priceMap && underlyingAsset !== 'MERIDIAN_LP') {
                  if (underlyingAsset === 'MOVE' || symbol.includes('MOVE') || symbol.includes('stMOVE')) {
                    const movePrice = priceMap['0xa'] || priceMap['0x1'] || 0;
                    usdValue = amount * movePrice;
                  } else if (underlyingAsset === 'USDC.e' || underlyingAsset === 'USDT.e') {
                    usdValue = amount;
                  } else if (underlyingAsset === 'WBTC.e') {
                    const btcPrice = Object.entries(priceMap).find(([addr]) =>
                      addr.toLowerCase().includes('wbtc') || addr.toLowerCase().includes('btc')
                    )?.[1] || 95000;
                    usdValue = amount * btcPrice;
                  } else if (underlyingAsset === 'WETH.e') {
                    const ethPrice = Object.entries(priceMap).find(([addr]) =>
                      addr.toLowerCase().includes('weth') || addr.toLowerCase().includes('eth')
                    )?.[1] || 3500;
                    usdValue = amount * ethPrice;
                  }
                }
                let meridianComposition = {};
                if (protocol === 'meridian' && meridianCompositions.length > 0) {
                  const compositionIndex = meridianLPIndex < meridianCompositions.length ? meridianLPIndex : 0;
                  meridianComposition = {
                    liquidityX: meridianCompositions[compositionIndex].liquidityX,
                    liquidityY: meridianCompositions[compositionIndex].liquidityY,
                    liquidityTokens: meridianCompositions[compositionIndex].liquidityTokens,
                    stakedAmount: meridianCompositions[compositionIndex].stakedAmount,
                    tokenX: meridianCompositions[compositionIndex].tokenX,
                    tokenY: meridianCompositions[compositionIndex].tokenY,
                    poolId: meridianCompositions[compositionIndex].poolId
                  };

                  if (!meridianComposition.liquidityTokens || meridianComposition.liquidityTokens <= 0) {
                    meridianComposition.liquidityTokens = Math.round(amount * 1_000_000);
                  }
                  devLog('Adding Meridian LP #' + meridianLPIndex + ' with composition:', meridianComposition);
                  meridianLPIndex++;
                } else if (protocol === 'meridian') {
                  meridianComposition = {
                    liquidityTokens: Math.round(amount * 1_000_000),
                  };
                }

                if (protocol === 'meridian') {
                  const poolAddress = String(balance.address || balance.type || '').toLowerCase();
                  const poolInfo = meridianPoolInfoByAddress[poolAddress];
                  const userLpRaw = Number(balance.rawAmount || 0);

                  if (poolInfo && poolInfo.totalSupplyRaw > 0 && userLpRaw > 0) {
                    const userShare = userLpRaw / poolInfo.totalSupplyRaw;
                    const poolTokens = poolInfo.tokens
                      .map((token) => ({
                        ...token,
                        userAmount: token.amount * userShare,
                      }))
                      .filter((token) => token.userAmount > 0);

                    if (poolTokens.length > 0) {
                      const poolMatchesPosition = isMeridianPoolMatch(
                        meridianComposition.tokenX,
                        meridianComposition.tokenY,
                        poolTokens
                      );

                      if (poolMatchesPosition || (!meridianComposition.tokenX && !meridianComposition.tokenY)) {
                        meridianComposition.poolId = poolInfo.poolId;
                        meridianComposition.poolTokens = poolTokens.map((token) => ({
                          symbol: token.symbol,
                          amount: token.userAmount,
                          decimals: token.decimals,
                          address: token.assetType,
                        }));

                        if (!meridianComposition.tokenX && poolTokens[0]) {
                          meridianComposition.tokenX = poolTokens[0].symbol;
                        }
                        if (!meridianComposition.tokenY && poolTokens[1]) {
                          meridianComposition.tokenY = poolTokens[1].symbol;
                        }

                        if (priceMap) {
                          const stableSymbols = ['USDT', 'USDT.E', 'USDC', 'USDC.E', 'USDCX', 'USDA', 'USDE'];
                          const meridianUsdValue = poolTokens.reduce((sum, token) => {
                            const tokenAddress = String(token.assetType || '').toLowerCase();
                            const tokenSymbol = String(token.symbol || '').toUpperCase();

                            let tokenPrice = 0;
                            if (tokenAddress && priceMap[tokenAddress] !== undefined) {
                              tokenPrice = Number(priceMap[tokenAddress]) || 0;
                            } else if (stableSymbols.includes(tokenSymbol)) {
                              tokenPrice = 1;
                            }

                            return sum + (token.userAmount * tokenPrice);
                          }, 0);

                          if (meridianUsdValue > 0) {
                            usdValue = meridianUsdValue;
                          }
                        }
                      } else {
                        console.warn('Warning: Meridian pool token mismatch, skipping pool override', {
                          expected: [meridianComposition.tokenX, meridianComposition.tokenY],
                          actual: poolTokens.map((token) => token.symbol),
                          poolId: poolInfo.poolId,
                        });
                      }
                    }
                  }
                }

                lpPositions.push({
                  id: `lp-${balance.type || balance.address}`,
                  protocol,
                  protocolName: protocol.charAt(0).toUpperCase() + protocol.slice(1),
                  symbol: symbol,
                  name: name || symbol,
                  amount,
                  decimals: balance.decimals || 8,
                  address: balance.type || balance.address,
                  underlying: underlyingAsset,
                  usdValue,
                  liquidityValue: usdValue,
                  isMeridianLP: underlyingAsset === 'MERIDIAN_LP',
                  ...meridianComposition
                });
                break;
              }
            }
          });
        }
        if (viewingAddress) {
          try {
            const { nftHoldings, yuzuEvents } = await getCachedYuzuDiscovery(viewingAddress);
            const yuzuLiquidityMap = {};
            for (const event of yuzuEvents) {
              try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (data && data.position_id) {
                  const posId = String(data.position_id);
                  if (!yuzuLiquidityMap[posId] || event.transaction_version > yuzuLiquidityMap[posId].version) {
                    yuzuLiquidityMap[posId] = {
                      version: event.transaction_version,
                      liquidity: data.liquidity_delta || data.liquidity || 0,
                      amount0: data.amount_0 || data.token_0_amount || 0,
                      amount1: data.amount_1 || data.token_1_amount || 0,
                      pool: data.pool_address || data.pool || '',
                    };
                  }
                }
              } catch {
                // Ignore malformed Yuzu event payloads
              }
            }
            const YUZU_NFT_MANAGER = '0x1d0434ae92598710f5ccbfbf51cf66cf2fe8ba8e77381bed92f45bb32d237bc2';

            for (const nft of nftHoldings) {
              const collectionName = nft.current_token_data?.current_collection?.collection_name || '';
              const creatorAddress = nft.current_token_data?.current_collection?.creator_address || '';
              const tokenName = nft.current_token_data?.token_name || '';
              const isYuzuPosition =
                collectionName.toLowerCase().includes('yuzu') ||
                collectionName.toLowerCase().includes('liquidity position') ||
                creatorAddress.toLowerCase() === YUZU_NFT_MANAGER;

              if (isYuzuPosition) {
                const positionId = tokenName;
                const poolAddress = creatorAddress;
                let poolPair = 'LP Position';
                const collectionMatch = collectionName.match(/\|\s*([A-Za-z0-9.]+\/[A-Za-z0-9.]+)\s*\|/i);
                if (collectionMatch) {
                  poolPair = collectionMatch[1].replace('/', ' / ');
                }

                let liquidityValue = 0;
                let token0Amount = 0;
                let token1Amount = 0;
                const getMovePrice = () => {
                  if (!priceMap) return 0.5;
                  return priceMap['0xa'] || priceMap['0x1'] || 0.5;
                };
                if (poolAddress && positionId) {
                  try {
                    const response = await fetch(`${DEFAULT_NETWORK.rpc}/view`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        function: '0x46566b4a16a1261ab400ab5b9067de84ba152b5eb4016b217187f2a2ca980c5a::position_nft_manager::get_position_token_amounts',
                        typeArguments: [],
                        arguments: [poolAddress, positionId]
                      })
                    });

                    if (response.ok) {
                      const result = await response.json();
                      if (Array.isArray(result) && result.length >= 2) {
                        const tokens = poolPair.split('/').map(t => t.trim().replace(/\.e$/, '').toUpperCase());
                        const getTokenDecimals = (symbol) => {
                          if (['USDC', 'USDCX', 'USDT', 'USDA', 'USDE', 'DAI'].includes(symbol)) return 6;
                          return 8;
                        };

                        const decimals0 = tokens[0] ? getTokenDecimals(tokens[0]) : 8;
                        const decimals1 = tokens[1] ? getTokenDecimals(tokens[1]) : 8;

                        token0Amount = Number(result[0]) / Math.pow(10, decimals0);
                        token1Amount = Number(result[1]) / Math.pow(10, decimals1);
                        const token0Symbol = tokens[0] || '';
                        const token1Symbol = tokens[1] || '';
                        const isStable0 = ['USDC', 'USDCX', 'USDT', 'USDA', 'USDE', 'DAI'].includes(token0Symbol);
                        const isStable1 = ['USDC', 'USDCX', 'USDT', 'USDA', 'USDE', 'DAI'].includes(token1Symbol);
                        const MEME_TOKENS = ['CAPY', 'MOVECAT', 'GMOVE', 'TUBI', 'GCAT'];
                        const isMeme0 = MEME_TOKENS.includes(token0Symbol);
                        const isMeme1 = MEME_TOKENS.includes(token1Symbol);
                        if (isMeme0 || isMeme1) {
                          liquidityValue = 0;
                        } else if (isStable0 && isStable1) {
                          liquidityValue = token0Amount + token1Amount;
                        } else if (token0Symbol === 'MOVE' && isStable1) {
                          const movePrice = getMovePrice();
                          liquidityValue = (token0Amount * movePrice) + token1Amount;
                        } else if (token1Symbol === 'MOVE' && isStable0) {
                          const movePrice = getMovePrice();
                          liquidityValue = token0Amount + (token1Amount * movePrice);
                        } else {
                          liquidityValue = 0;
                        }
                      }
                    }
                  } catch (err) {
                    console.warn('Failed to fetch Yuzu position value:', err);
                  }
                }

                lpPositions.push({
                  id: `yuzu-nft-${nft.token_data_id}`,
                  protocol: 'yuzu',
                  protocolName: 'Yuzu Swap',
                  symbol: `YUZ-LP #${positionId}`,
                  name: poolPair,
                  amount: Number(nft.amount) || 1,
                  decimals: 0,
                  address: poolAddress || nft.token_data_id,
                  underlying: poolPair,
                  usdValue: liquidityValue,
                  liquidityValue,
                  token0Amount,
                  token1Amount,
                  isNFT: true,
                  positionId,
                  tokenDataId: nft.token_data_id,
                });
              }
            }
          } catch (error) {
            console.warn("Failed to fetch Yuzu NFT positions:", error);
          }
        }

        if (!cancelled) {
          setLiquidityPositions(lpPositions);
        }
      } catch (error) {
        devLog("Error in detectLPPositions:", error);
      } finally {
        if (!cancelled) {
          setLpLoading(false);
        }
      }
    };
    detectLPPositions();
    return () => { cancelled = true; };
  }, [getCachedMeridianPoolInfo, getCachedYuzuDiscovery, indexerBalances, viewingAddress, priceMap, positions]);
  useEffect(() => {
    if (indexerLoading) {
      if (balances.length === 0) {
        setAssetsLoading(true);
      }
      devLog("Indexer loading...");
      return; // Early return - don't process yet
    }

    if (indexerError && viewingAddress && !movementClientLoading && movementClient) {
      console.warn("Warning: Indexer error, trying RPC fallback:", indexerError);
      fetchAssets(viewingAddress);
      return;
    }

    if (indexerBalances && indexerBalances.length > 0) {
      devLog("Using indexer balances:", indexerBalances.length, "tokens");
      const withPrices = indexerBalances.map(balance => {
        let price = 0;
        if (priceMap[balance.address]) {
          price = priceMap[balance.address];
        }
        else if (balance.symbol === "MOVE" || balance.symbol === "move") {
          price = priceMap["0xa"] || priceMap["0x1"] || 0;
        }
        else if (balance.symbol === "USDT" || balance.symbol === "USDC") {
          price = 1.0;
        }
        else {
          price = priceMap[balance.fullType] ?? 0;
        }

        const usdValue = balance.numericAmount * price;
        let formattedUsdValue;
        if (usdValue > 0 && usdValue < 0.01) {
          formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 6,
          })}`;
        } else if (usdValue > 0 && usdValue < 1) {
          formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          })}`;
        } else {
          formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`;
        }
        const isHighValueToken = ['BTC', 'WBTC', 'ETH', 'WETH'].includes(balance.symbol);
        let updatedAmount = balance.amount;
        if (isHighValueToken && balance.numericAmount < 0.01) {
          updatedAmount = balance.numericAmount.toLocaleString(undefined, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 8,
          });
        } else if (isHighValueToken && balance.numericAmount < 1) {
          updatedAmount = balance.numericAmount.toLocaleString(undefined, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 6,
          });
        }

        return {
          ...balance,
          amount: updatedAmount,
          price,
          usdValue,
          formattedValue: formattedUsdValue,
        };
      });
      const verified = withPrices.filter((t) => t && t.isKnown);
      verified.sort((a, b) => b.usdValue - a.usdValue);
      const totalUsd = verified.reduce((sum, t) => sum + (t.usdValue || 0), 0);

      setBalances(verified);
      setTotalUsdValue(totalUsd);
      setAssetsLoading(false);
      setError(null);
    } else if (indexerBalances && indexerBalances.length === 0 && !indexerLoading && viewingAddress && !movementClientLoading && movementClient) {
      console.warn("Warning: Indexer returned no balances, trying RPC fallback...");
      fetchAssets(viewingAddress);
    } else if (!indexerLoading && !viewingAddress) {
      setAssetsLoading(false);
    }
  }, [indexerBalances, indexerLoading, indexerError, priceMap, viewingAddress, fetchAssets, balances.length, movementClientLoading, movementClient]);



  useEffect(() => {
    const fetchWalletData = async () => {
      if (!viewingAddress) {
        setWalletAge(null);
        return;
      }

      try {
        const ageData = await getWalletAge(viewingAddress);
        setWalletAge(ageData);
        devLog("Wallet age data:", ageData);
      } catch (err) {
        console.warn("Failed to fetch wallet data:", err);
      }
    };

    fetchWalletData();
  }, [viewingAddress]);
  const formatWalletAge = (ageData) => {
    if (!ageData?.firstTxTimestamp) return null;

    const firstDate = new Date(ageData.firstTxTimestamp);
    const now = new Date();
    const diffMs = now - firstDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 1) return "< 1";
    return diffDays.toString();
  };

  const handleRefresh = () => {
    if (viewingAddress) {
      devLog("Refreshing assets for:", viewingAddress);
      fetchAssets(viewingAddress);
    }
  };



  // eslint-disable-next-line no-unused-vars
  const handleViewExplorer = (token) => {

    if (token?.address) window.open(`${currentNetwork.explorer}/account/${token.address}`, "_blank");

  };


  return (
    <>

      <section className="hero-v3 fade-in">

        <div className="hero-v3-left">
          {viewingAddress && (
            <div className="hero-profile-section">
              <div className="hero-profile-card">
                <div
                  className="hero-profile-avatar"
                  onClick={() => setShowProfileModal(true)}
                  role="button"
                  tabIndex={0}
                  onKeyPress={(e) => e.key === 'Enter' && setShowProfileModal(true)}
                >
                  <img
                    src={userAvatarSrc}
                    alt="User"
                    className="hero-avatar-image"
                  />
                </div>
                <div className="hero-profile-socials-grid">
                  {userProfile?.twitter ? (
                    <a
                      href={`https://twitter.com/${userProfile.twitter.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hero-social-link"
                      title={`Twitter: @${userProfile.twitter.replace('@', '')}`}
                    >
                      <span className="hero-social-icon">X</span>
                    </a>
                  ) : null}
                  {userProfile?.telegram ? (
                    <a
                      href={`https://t.me/${userProfile.telegram.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hero-social-link"
                      title={`Telegram: @${userProfile.telegram.replace('@', '')}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="hero-social-icon">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a11.955 11.955 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.153-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.36-1.37.2-.456-.134-.883-.414-1.289-.77-.147-.127-.336-.191-.52-.191-.055 0-.109.005-.163.013-.502.113-1.005.656-1.059 1.22 0 .57.38.85.583 1.027.378.338.884.592 1.297.637.502.038 1.091-.044 1.601-.135 1.027-.226 1.918-.779 2.425-1.779.29-.576.17-1.392.589-1.487z" />
                      </svg>
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          <div className="hero-v3-main-content">

            <span className="hero-v3-title">
              {userProfile?.username ? (
                t(language, 'dashNetWorthUser', { username: userProfile.username })
              ) : t(language, 'dashNetWorth')}
            </span>

            <div className="hero-v3-value">

              {assetsLoading ? <NetWorthValueSkeleton /> :

                error ? <span style={{ fontSize: "24px", opacity: 0.7 }}>Error</span> :

                  <span>{formatCurrencyValue(convertUSD(combinedNetWorth))}</span>

              }

              {!assetsLoading && portfolio24hChange !== null && (

                <span className={`hero-v3-change ${portfolio24hChange >= 0 ? 'positive' : 'negative'}`}>

                  {portfolio24hChange >= 0 ? '+' : '-'} {Math.abs(portfolio24hChange).toFixed(2)}%

                </span>

              )}

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
                        const btn = e.currentTarget;
                        btn.classList.add('copied');
                        setTimeout(() => btn.classList.remove('copied'), 1000);
                      }}
                      title="Copy address"
                    >
                      <img src="/copy.png" alt="Copy" className="copy-icon-img" />
                    </button>
                  </div>
                  {userProfile?.bio && (
                    <div className="hero-v3-bio">
                      {userProfile.bio}
                    </div>
                  )}
                </>
              ) : (
                <span className="hero-v3-label">{t(language, 'dashNoWalletConnected')}</span>
              )}
            </div>



            {assetsLoading ? (

              <NetWorthStatsSkeleton />

            ) : !error && (

              <div className="hero-v3-stats">

                <div className="hero-v3-stat">

                  <span className="hero-v3-stat-value">

                    {formatCurrencyValue(convertUSD(totalUsdValue))}

                  </span>

                  <span className="hero-v3-stat-label">{t(language, 'dashWalletBalance')}</span>

                </div>



                <div className="hero-v3-stat">

                  <span className={`hero-v3-stat-value ${(defiNetValue + liquidityTotalValue) >= 0 ? 'positive' : 'negative'}`}>

                    {formatCurrencyValue(convertUSD(defiNetValue + liquidityTotalValue))}

                  </span>

                  <span className="hero-v3-stat-label">{t(language, 'dashUtilizedBalance')}</span>

                </div>

                {walletAge && formatWalletAge(walletAge) && (

                  <div className="hero-v3-stat wallet-age">

                    <span className="hero-v3-stat-value age">

                      {formatWalletAge(walletAge)}

                    </span>

                    <span className="hero-v3-stat-label">{t(language, 'dashWalletAge')} ({t(language, 'dashDays')})</span>

                  </div>

                )}

              </div>

            )}

          </div>

        </div>
        {error && <ErrorMessage message={error} onRetry={handleRefresh} />}

      </section>

      <section className="portfolio-tabs-row fade-in">
        <button
          type="button"
          className={`portfolio-tab-btn ${activeTab === PORTFOLIO_TABS.OVERVIEW ? 'active' : ''}`}
          onClick={() => setActiveTab(PORTFOLIO_TABS.OVERVIEW)}
        >
          {t(language, 'navPortfolio')}
        </button>
        <button
          type="button"
          className={`portfolio-tab-btn ${activeTab === PORTFOLIO_TABS.TRX ? 'active' : ''}`}
          onClick={() => setActiveTab(PORTFOLIO_TABS.TRX)}
        >
          {t(language, 'portfolioTabTrxHistory')}
        </button>
      </section>

      <div className="portfolio-content-panel fade-in" key={activeTab}>

        {activeTab === PORTFOLIO_TABS.OVERVIEW && (

          <>

            <section className="grid-section">

              <h3 className="section-title">{t(language, 'dashWalletBalance')}</h3>

              <div className="grid-container">

                {assetsLoading && (

                  <>

                    <SkeletonCard delay={0} />

                    <SkeletonCard delay={50} />

                    <SkeletonCard delay={100} />

                    <SkeletonCard delay={150} />

                  </>

                )}



                {!assetsLoading && !error && balances.length === 0 && !viewingAddress && (
                  <div className="empty-state">{t(language, 'dashConnectPortfolio')}</div>
                )}


                {!assetsLoading && !error && balances.length === 0 && viewingAddress && (
                  <div className="empty-state">{t(language, 'dashNoTokens')}</div>
                )}



                {!assetsLoading && balances.map((token, index) => (

                  <TokenCard

                    key={token.id}

                    token={token}

                    delay={index * ANIMATION_DELAYS.TOKEN_CARD}
                    convertUSD={convertUSD}
                    formatCurrencyValue={formatCurrencyValue}
                    language={language}
                  />

                ))}

              </div>

            </section>

            <section className="grid-section">

              <h3 className="section-title">{t(language, 'dashDefiPositions')}</h3>

              <div className="grid-container">

                {(defiLoading || assetsLoading) && visibleDeFiPositions.length === 0 && (
                  <>
                    <SkeletonCard delay={0} />
                    <SkeletonCard delay={50} />
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
                    .map(([protocolName, protocolPositions]) => {
                      const netUsd = protocolPositions.reduce((sum, pos) => {
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
                    />
                  ));
                })()}

              </div>

            </section>

            <section className="grid-section">
              <h3 className="section-title">
                {t(language, 'dashLiquidityPositions')}
              </h3>
              <div className="grid-container lp-grid">
                {(lpLoading || indexerLoading) && (
                  <>
                    <SkeletonCard delay={0} />
                    <SkeletonCard delay={50} />
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
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === PORTFOLIO_TABS.TRX && (
          <section className="grid-section">
            <h3 className="section-title">{t(language, 'portfolioTransactionHistory')}</h3>
            <Suspense fallback={<RouteFallback />}>
              <TrxHistory walletAddress={viewingAddress} />
            </Suspense>
          </section>
        )}

      </div>
      {showProfileModal && (
        <div className="profile-modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowProfileModal(false)}>x</button>

            <div className="profile-modal-content">
              <div className="profile-modal-main">
                <div className="modal-avatar-section">
                  <img
                    src={modalAvatarSrc}
                    alt="User"
                    className="modal-avatar-image"
                  />
                </div>
                <div className="modal-info-section">
                  <h2 className="modal-username">{userProfile?.username || t(language, 'dashAnonymousUser')}</h2>
                  <div className="modal-address">
                    {viewingAddress && (
                      <>
                        <span>{viewingAddress.slice(0, 6)}...{viewingAddress.slice(-4)}</span>
                        <button
                          className="modal-copy-btn"
                          onClick={(e) => {
                            navigator.clipboard.writeText(viewingAddress);
                            const btn = e.currentTarget;
                            btn.classList.add('copied');
                            setTimeout(() => btn.classList.remove('copied'), 1000);
                          }}
                          title="Copy address"
                        >
                          <img src="/copy.png" alt="Copy" className="copy-icon-img" />
                        </button>
                      </>
                    )}
                  </div>
                  {userProfile?.bio && (
                    <p className="modal-bio">{userProfile.bio}</p>
                  )}
                  {canEditProfile && (
                    <button
                      className="modal-edit-btn"
                      onClick={() => {
                        setShowProfileModal(false);
                        navigate('/profile');
                      }}
                    >
                      {t(language, 'dashEditProfile')}
                    </button>
                  )}
                </div>
                {!levelLoading && (
                  <div className="modal-level-section">
                    <div className="modal-level-row">
                      <span className="modal-level-label">{t(language, 'dashCurrentLevel')}</span>
                      <span className="modal-level-value">{level}</span>
                    </div>
                    <div className="modal-xp-row">
                      <span className="modal-xp-label">{t(language, 'dashExpPoints')}</span>
                      <span className="modal-xp-value">{xp} / {nextLevelXP}</span>
                    </div>
                    <div className="modal-xp-bar-container">
                      <div className="modal-xp-bar-fill" style={{ width: `${xpProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>
               <div className="modal-badges-section">
                <h3 className="modal-badges-title">{t(language, 'dashCollectedBadges')} ({userBadges.length})</h3>
                <div className="modal-onchain-badges">
                  <h4 className="modal-onchain-title">{t(language, 'onchainBadges')}</h4>
                  {onchainBadgesLoading ? (
                    <div className="modal-onchain-loading">{t(language, 'dashLoadingBadges')}</div>
                  ) : onchainBadges && onchainBadges.length > 0 ? (
                    <div className="modal-onchain-badges-grid">
                      {onchainBadges.map((b) => (
                        <div key={b.id} className={`modal-onchain-badge ${b.earned ? 'owned' : 'locked'}`}>
                          <div className="modal-onchain-badge-icon">{b.imageUrl ? <img src={b.imageUrl} alt={b.name} onError={(e) => { e.target.style.display = 'none' }} /> : (b.name ? b.name[0] : 'B')}</div>
                          <div className="modal-onchain-badge-info">
                            <div className="modal-onchain-badge-name">{b.name}</div>
                            <div className="modal-onchain-badge-meta">{b.earned ? t(language, 'dashOwned') : t(language, 'dashNotOwned')}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="modal-onchain-empty">{t(language, 'dashNoOnchainBadges')}</div>
                  )}
                </div>
                {(persistedBadges && persistedBadges.length > 0) || userBadges.length > 0 ? (
                  <div className="modal-badges-grid">
                    {(persistedBadges && persistedBadges.length > 0 ? persistedBadges : userBadges).map(badge => (
                      <div key={badge.id} className="modal-badge-item">
                        <div className="modal-badge-icon-box">
                          <span className="modal-badge-icon">{badge.icon || 'Badge'}</span>
                        </div>
                        <div className="modal-badge-info">
                          <div className="modal-badge-name">{badge.name}</div>
                          <div className="modal-badge-description">{badge.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="modal-no-badges">{t(language, 'dashNoBadgesEarned')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </>

  );

};

export default Dashboard;
