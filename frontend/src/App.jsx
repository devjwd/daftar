import React, { useEffect, useState, useCallback, useMemo, Suspense, lazy } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import "./App.css";



// --- IMPORTS ---



// Movement / Aptos SDKs

import { AptosWalletAdapterProvider, useWallet } from "@aptos-labs/wallet-adapter-react";

import { PetraWallet } from "petra-plugin-wallet-adapter";

import { OKXWallet } from "@okwallet/aptos-wallet-adapter";

import { Aptos, AptosConfig, Network, AccountAddress } from "@aptos-labs/ts-sdk";



// Utils & Config

import { DEFAULT_NETWORK } from "./config/network";
import { getEnv } from "./config/envValidator";

import { INTERVALS, FORMATTING, ANIMATION_DELAYS } from "./config/constants";

import { parseCoinType, getTokenDecimals, isValidAddress } from "./utils/tokenUtils";
import { getLevelBasedPfp } from "./utils/levelPfp";
import { applyTheme, getStoredThemePreference } from "./utils/theme";
import { devLog } from "./utils/devLogger";

import { getTokenInfo, getTokenAddressBySymbol } from "./config/tokens";
import { TOKEN_VISUALS, DEFI_PROTOCOL_VISUALS, DEFAULT_TOKEN_COLOR, DEFAULT_PROTOCOL_VISUAL } from "./config/display";

import ErrorBoundary from "./components/ErrorBoundary";



// Hooks
import { useDeFiPositions } from "./hooks/useDeFiPositions";
import { useTokenPrices } from "./hooks/useTokenPrices";
import { useIndexerBalances } from "./hooks/useIndexerBalances";
import { useProfile } from "./hooks/useProfile";
import { useUserLevel } from "./hooks/useUserLevel";
import { useCurrency } from "./hooks/useCurrency";
import useBadges from "./hooks/useBadges";
import useUserBadges from "./hooks/useUserBadges";

// Indexer services
import { getWalletAge, getUserNFTHoldings, getYuzuLiquidityPositions, getUserTokenBalances } from "./services/indexer";

// Components
const Layout = lazy(() => import("./components/Layout"));
const SwapPage = lazy(() => import("./pages/Swap"));
const Home = lazy(() => import("./pages/Home"));
const Profile = lazy(() => import("./pages/Profile"));
const ProfileView = lazy(() => import("./pages/ProfileView"));
const Settings = lazy(() => import("./pages/Settings"));
const Badges = lazy(() => import("./pages/Badges"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Admin = lazy(() => import("./pages/Admin"));
const More = lazy(() => import("./pages/More"));
const Level = lazy(() => import("./pages/Level"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
import ProfileCard from "./components/ProfileCard";




// --- COMPONENT: Token Card ---

const SWAP_ENABLED = getEnv('VITE_ENABLE_SWAP', true);

const TokenCard = ({ token, delay, convertUSD, formatCurrencyValue }) => {
  const tokenInfo = getTokenInfo(token.address);
  const isKnownToken = !!tokenInfo;

  const symbol = (token.symbol || '').toUpperCase();
  // Strip .E suffix for logo/color lookup (e.g., WETH.E -> WETH, USDC.E -> USDC)
  const baseSymbol = symbol.replace(/\.E$/i, '');
  const visual = TOKEN_VISUALS[baseSymbol] || TOKEN_VISUALS[symbol] || null;
  const tokenLogo = visual?.logo || null;
  const tokenColor = visual?.color || DEFAULT_TOKEN_COLOR;

  // Parse USD value
  const usdValueNum = parseFloat(token.formattedValue?.replace('$', '').replace(',', '') || '0');
  const hasValue = usdValueNum > 0;
  
  // Convert to selected currency
  const convertedValue = convertUSD ? convertUSD(usdValueNum) : usdValueNum;
  const displayValue = formatCurrencyValue ? formatCurrencyValue(convertedValue) : `$${usdValueNum.toFixed(2)}`;

  // Format amount with more decimals for high-value coins
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
      {/* Glow effect */}
      <div className="token-card-glow" />
      
      {/* Main content */}
      <div className="token-card-content">
        {/* Left: Logo & Info */}
        <div className="token-card-left">
          <div className={`token-logo-wrapper ${tokenLogo ? 'has-image' : ''}`}>
            {tokenLogo ? (
              <img 
                src={tokenLogo} 
                alt={symbol}
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
                  <path d="M1 4L3 6L7 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            )}
          </div>
          
          <div className="token-info">
            <span className="token-symbol">{symbol || 'TOKEN'}</span>
            <span className="token-network">Movement</span>
          </div>
        </div>

        {/* Right: Balance */}
        <div className="token-card-right">
          <span className="token-balance">{formattedAmount}</span>
          <span className={`token-value ${hasValue ? 'has-value' : ''}`}>
            {displayValue}
          </span>
        </div>
      </div>

      {/* Bottom accent line */}
      <div className="token-card-accent" />
    </div>
  );
};



// --- COMPONENT: Loading Skeleton Card ---

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



// --- COMPONENT: Staking Card ---

const StakingCard = ({ name, value, type, delay }) => (

  <div

    className="card staking-card"

    style={{ animationDelay: `${delay}ms` }}

  >

    <div className="icon-square"></div>

    <div className="staking-info">

      <span className="staking-name">{name}</span>

      <span className="staking-value" style={{fontSize: '14px', opacity: 0.8}}>{type}: {value}</span>

    </div>

  </div>

);

// --- COMPONENT: DeFi Position Card (Professional Design) ---
const DeFiPositionCard = ({ protocolPositions, delay, priceMap, convertUSD, formatCurrencyValue, currencySymbol }) => {
  // Get token price
  const getTokenPrice = (symbol) => {
    if (!priceMap) return 0;
    const upperSymbol = (symbol || '').toUpperCase();
    // Try direct symbol lookup in priceMap
    const address = getTokenAddressBySymbol(upperSymbol);
    if (address && priceMap[address]) return priceMap[address];
    // Stablecoin fallback
    if (upperSymbol === 'USDC' || upperSymbol === 'USDT') return 1.0;
    return 0;
  };

  // Get protocol info from first position
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

  // Separate positions by type
  const supplyPositions = protocolPositions.filter(p => p.type === 'Lending' || p.type === 'Staking' || p.type === 'Liquidity');
  const debtPositions = protocolPositions.filter(p => p.type === 'Debt');
  
  // Format value
  const formatValue = (val) => {
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  // Format USD value with currency conversion
  const formatUsdValue = (val) => {
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return formatCurrencyValue(0);
    const converted = convertUSD(num);
    if (converted >= 1000000) return `${currencySymbol}${(converted / 1000000).toFixed(2)}M`;
    if (converted >= 1000) return `${currencySymbol}${(converted / 1000).toFixed(2)}K`;
    if (converted < 0.01) return formatCurrencyValue(converted, undefined, 4);
    return formatCurrencyValue(converted);
  };

  // Calculate USD values
  const getPositionUsdValue = (pos) => {
    const amount = parseFloat(pos.value || 0);
    const price = getTokenPrice(pos.tokenSymbol);
    return amount * price;
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
    const poolSuffix = pool.startsWith("0x") && pool.length > 10 ? `…${pool.slice(-6)}` : null;

    const pendingStakeRaw = Number(pos?.pendingStakeAmount || 0);
    const pendingWithdrawalRaw = Number(pos?.pendingWithdrawalAmount || 0);
    const pendingMove = (pendingStakeRaw + pendingWithdrawalRaw) / 100000000;

    const poolPart = poolSuffix ? `Pool ${poolSuffix}` : null;
    const pendingPart = pendingMove > 0 ? `Pending ${formatValue(pendingMove)} MOVE` : null;

    if (poolPart && pendingPart) return `${poolPart} · ${pendingPart}`;
    return poolPart || pendingPart;
  };

  const totalSupplyUsd = supplyPositions.reduce((sum, p) => sum + getPositionUsdValue(p), 0);
  const totalDebtUsd = debtPositions.reduce((sum, p) => sum + getPositionUsdValue(p), 0);
  const netUsd = totalSupplyUsd - totalDebtUsd;

  return (
    <div className="defi-card-v2" style={{ animationDelay: `${delay}ms`, '--protocol-color': protocol.color }}>
      {/* Accent line */}
      <div className="defi-v2-accent" style={{ background: protocol.gradient }} />
      
      {/* Header */}
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
          <span className="defi-v2-type">
            {supplyPositions.length > 0 && debtPositions.length > 0 
              ? 'Lending & Borrowing' 
              : supplyPositions.length > 0 ? 'Lending' : 'Borrowing'}
          </span>
        </div>
        {firstPos.protocolWebsite && (
          <a href={firstPos.protocolWebsite} target="_blank" rel="noopener noreferrer" className="defi-v2-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        )}
      </div>

      {/* Two Column Layout - Fixed Width */}
      <div className="defi-v2-columns">
        {/* Supply Column */}
        <div className="defi-v2-column supply">
          <div className="defi-v2-column-header">
            <span className="defi-v2-column-label">Supplied</span>
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
              <div className="defi-v2-empty">No supply positions</div>
            )}
          </div>
        </div>

        {/* Borrow Column */}
        <div className="defi-v2-column borrow">
          <div className="defi-v2-column-header">
            <span className="defi-v2-column-label">Borrowed</span>
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
              <div className="defi-v2-empty">No debt positions</div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="defi-v2-footer">
        <div className="defi-v2-net">
          <span className="defi-v2-net-label">NET POSITION</span>
          <span className={`defi-v2-net-value ${netUsd >= 0 ? 'positive' : 'negative'}`}>
            {netUsd >= 0 ? '+' : ''}{formatUsdValue(netUsd)}
          </span>
        </div>
        {debtPositions.length > 0 && totalSupplyUsd > 0 && (
          <div className="defi-v2-health">
            <span className="defi-v2-health-label">Health</span>
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
    </div>
  );
};

// --- COMPONENT: Liquidity Position Card ---
const LiquidityCard = ({ position, delay, priceMap, convertUSD, formatCurrencyValue, currencySymbol }) => {
  // Protocol data for LP positions (only liquidity pools, not lending)
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

  // Check if this position was deposited through Canopy (has Canopy vault tokens)
  const isCanopyDeposit = position.protocol === 'canopy' || 
    position.symbol?.startsWith('cv') || 
    position.symbol?.includes('stMOVE');

  // Format values
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
    // Handle very small values (< equivalent of $0.01) 
    if (converted > 0 && converted < 0.01) return `< ${currencySymbol}0.01`;
    if (converted < 1) return formatCurrencyValue(converted, undefined, 4); // More precision for small values
    return formatCurrencyValue(converted);
  };

  // Get underlying value estimate (for liquid staking, 1:1 with base token)
  const getUnderlyingValue = () => {
    // If position already has a valid USD value, use it
    if (position.usdValue && position.usdValue > 0) {
      return position.usdValue;
    }
    
    // If position has liquidityValue (from Yuzu NFT), use it
    if (position.liquidityValue && position.liquidityValue > 0) {
      return position.liquidityValue;
    }
    
    if (!priceMap) return 0;
    
    const amount = parseFloat(position.amount) || 0;
    if (amount === 0) return 0;
    
    // For Yuzu NFT positions, use the stored liquidity value
    if (position.isNFT && position.protocol === 'yuzu') {
      // Use stored USD value from position data (fetched via view function)
      if (position.usdValue && position.usdValue > 0) {
        return position.usdValue;
      }
      // Fallback: estimate from liquidity amount if available
      if (position.liquidityValue) {
        return position.liquidityValue;
      }
      return 0;
    }
    
    // For Meridian LP tokens, value cannot be calculated without pool composition
    if (position.isMeridianLP) {
      return 0;
    }
    
    // For Canopy cvMOVE or stMOVE, use MOVE price
    if (position.symbol?.includes('cvMOVE') || position.symbol?.includes('stMOVE') || 
        position.symbol?.includes('MOVE') && position.protocol === 'canopy') {
      const movePrice = priceMap['0xa'] || priceMap['0x1'] || 0;
      return amount * movePrice;
    }
    
    // For Canopy cvWBTC or BTC positions
    if (position.symbol?.includes('cvWBTC') || position.symbol?.includes('WBTC') || position.symbol?.includes('BTC')) {
      // Find BTC price in priceMap
      const btcPrice = Object.entries(priceMap).find(([addr]) => 
        addr.toLowerCase().includes('wbtc') || addr.toLowerCase().includes('btc')
      )?.[1] || 95000; // Fallback BTC price
      return amount * btcPrice;
    }
    
    // For cvWETH or ETH positions
    if (position.symbol?.includes('cvWETH') || position.symbol?.includes('WETH') || position.symbol?.includes('ETH')) {
      const ethPrice = Object.entries(priceMap).find(([addr]) => 
        addr.toLowerCase().includes('weth') || addr.toLowerCase().includes('eth')
      )?.[1] || 3500; // Fallback ETH price
      return amount * ethPrice;
    }
    
    // For LayerBank lMOVE, use MOVE price
    if (position.symbol?.includes('lMOVE')) {
      const movePrice = priceMap['0xa'] || priceMap['0x1'] || 0;
      return amount * movePrice;
    }
    
    // For Meridian LP tokens - cannot value without pool composition data
    if (position.protocol === 'meridian' && position.symbol?.includes('MER-LP')) {
      return 0;
    }
    
    // For stablecoins (USDC, USDT), value is 1:1 with USD
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
  const primaryLabel = isPoolStylePrimary ? 'Pool' : 'Balance';
  const primaryValue = position.isNFT
    ? (position.name || 'LP Position')
    : (position.protocol === 'meridian' ? meridianPoolLabel : formatValue(position.amount));
  const secondaryLabel = position.isNFT ? 'Position' : 'Underlying Asset';
  const secondaryValue = position.isNFT
    ? `#${position.positionId || position.tokenDataId?.slice(-8) || 'NFT'}`
    : (position.underlying || position.symbol?.replace('cv', '').replace('l', '') || 'MOVE');

  let detailLabel = 'Underlying';
  let detailValue = position.underlying || position.symbol?.replace('cv', '').replace('l', '') || 'Not available';

  if (position.isNFT && position.protocol === 'yuzu' && (position.token0Amount > 0 || position.token1Amount > 0)) {
    detailLabel = 'Token Amounts';
    detailValue = `${position.token0Amount > 0 ? `${formatValue(position.token0Amount)} ${position.name?.split(' / ')[0] || 'Token0'}` : ''}${position.token0Amount > 0 && position.token1Amount > 0 ? ' + ' : ''}${position.token1Amount > 0 ? `${formatValue(position.token1Amount)} ${position.name?.split(' / ')[1] || 'Token1'}` : ''}`;
  } else if (position.protocol === 'meridian' && Array.isArray(position.poolTokens) && position.poolTokens.length > 0) {
    detailLabel = 'Token Composition';
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
      {/* Accent */}
      <div className="lp-card-accent" style={{ background: protocol.gradient }} />
      
      {/* Header */}
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
            <span className="lp-card-dot">•</span>
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
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        )}
      </div>

      {/* Body */}
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

// --- COMPONENT: Error Message ---
const ErrorMessage = ({ message, onRetry }) => (
  <div className="error-message">
    <p>{message}</p>
    {onRetry && <button onClick={onRetry} className="retry-btn">Retry</button>}

  </div>

);

const RouteFallback = () => (
  <div className="loading-indicator">Loading...</div>
);



// Redirect old /wallet/:address links to /profile/:address
const WalletRedirect = () => {
  const { address } = useParams();
  return <Navigate to={`/profile/${address}`} replace />;
};

// --- MAIN DASHBOARD ---

const Dashboard = () => {

  const { account, connected } = useWallet();
  const navigate = useNavigate();
  const location = useLocation();
  const { address: urlAddress } = useParams();
 
  // State

  const [balances, setBalances] = useState([]);

  const [assetsLoading, setAssetsLoading] = useState(false);

  const [error, setError] = useState(null);

  const [totalUsdValue, setTotalUsdValue] = useState(0);

  const [viewingAddress, setViewingAddress] = useState(null);

  const [walletAge, setWalletAge] = useState(null); // { firstTxTimestamp, txCount }
  const [liquidityPositions, setLiquidityPositions] = useState([]); // LP/Vault positions
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Custom Hooks - pass viewingAddress to support address search
  const { positions, loading: defiLoading } = useDeFiPositions(viewingAddress);
  const { prices: priceMap, priceChanges } = useTokenPrices();
  const { convertUSD, formatValue: formatCurrencyValue, currencySymbol } = useCurrency();

  const visibleDeFiPositions = useMemo(() => {
    if (!Array.isArray(positions) || positions.length === 0) return [];
    return positions.filter((pos) => {
      const protocolName = String(pos?.protocolName || "").toLowerCase();
      return protocolName !== "meridian";
    });
  }, [positions]);
  
  // Use indexer for balances (optimized for token queries)
  const { 
    balances: indexerBalances, 
    loading: indexerLoading, 
    error: indexerError,
  } = useIndexerBalances(viewingAddress);

  // Use profile hook to get user profile data
  const { profile: userProfile } = useProfile(viewingAddress);
  const { level: viewingLevel } = useUserLevel(viewingAddress);

  const modalProfileAddress = showProfileModal ? viewingAddress : null;
  // Calculate level only when profile modal is open
  const { level, xp, nextLevelXP, xpProgress, badges: userBadges, loading: levelLoading } = useUserLevel(modalProfileAddress);
  const userAvatarSrc = getLevelBasedPfp({
    level: viewingLevel,
    address: viewingAddress,
    preferredPfp: userProfile?.pfp,
  });
  const modalAvatarSrc = getLevelBasedPfp({
    level,
    address: viewingAddress,
    preferredPfp: userProfile?.pfp,
  });

  // Initialize viewingAddress from URL param — this is the primary source of truth
  useEffect(() => {
    if (urlAddress && isValidAddress(urlAddress)) {
      setViewingAddress(urlAddress);
    } else if (!urlAddress && !connected) {
      // No URL address and not connected — clear viewing address
      setViewingAddress(null);
    }
  }, [urlAddress, connected]);

  // Check for address in URL query params (from Layout search)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const addressParam = params.get('address');
    if (addressParam && isValidAddress(addressParam)) {
      // Navigate to wallet route instead of using query param
      navigate(`/profile/${addressParam}`, { replace: true });
    }
  }, [location.search, navigate]);

  // Config
  const currentNetwork = DEFAULT_NETWORK;
  const movementClient = useMemo(() => new Aptos(new AptosConfig({

      network: Network.CUSTOM,

      fullnode: currentNetwork.rpc

  })), [currentNetwork]);

  const modalBadgeAddress = modalProfileAddress;
  // Load badge data only when profile modal is open to avoid global navigation overhead
  const { badges: onchainBadges, loading: onchainBadgesLoading } = useBadges(modalBadgeAddress, { client: movementClient, enablePolling: false });
  // Persisted user badges from backend (if you run a server worker that stores `user_badges`)
  const { earnedBadges: persistedBadges } = useUserBadges(modalBadgeAddress);

  // Calculate total DeFi net value (supply - debt) in USD
  const defiNetValue = useMemo(() => {
    if (!visibleDeFiPositions || visibleDeFiPositions.length === 0 || !priceMap) return 0;
    
    const getTokenPrice = (symbol) => {
      const upperSymbol = (symbol || '').toUpperCase();
      const address = getTokenAddressBySymbol(upperSymbol);
      if (address && priceMap[address]) return priceMap[address];
      if (upperSymbol === 'USDC' || upperSymbol === 'USDT') return 1.0;
      return 0;
    };
    
    let totalSupply = 0;
    let totalDebt = 0;
    
    visibleDeFiPositions.forEach(pos => {
      const amount = parseFloat(pos.value || 0);
      const price = getTokenPrice(pos.tokenSymbol);
      const usdValue = amount * price;
      
      if (pos.type === 'Debt') {
        totalDebt += usdValue;
      } else {
        totalSupply += usdValue;
      }
    });
    
    return totalSupply - totalDebt;
  }, [visibleDeFiPositions, priceMap]);

  // Calculate total LP/Liquidity positions value
  const liquidityTotalValue = useMemo(() => {
    if (!liquidityPositions || liquidityPositions.length === 0) return 0;
    
    return liquidityPositions.reduce((total, position) => {
      const value = position.usdValue || position.liquidityValue || 0;
      return total + value;
    }, 0);
  }, [liquidityPositions]);

  // Combined net worth (token balances + DeFi net value + LP positions)
  const combinedNetWorth = useMemo(() => {
    return totalUsdValue + defiNetValue + liquidityTotalValue;
  }, [totalUsdValue, defiNetValue, liquidityTotalValue]);

  // Calculate weighted 24h portfolio change percentage
  const portfolio24hChange = useMemo(() => {
    if (!balances || balances.length === 0 || !priceChanges || combinedNetWorth === 0) {
      return null;
    }

    // Calculate weighted average of price changes based on USD value of each holding
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

    // If we have weighted values, calculate the percentage
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



  // --- ASSET FETCHING LOGIC ---
  // Always use RPC as primary source (more reliable), indexer as optional enhancement
  const fetchAssets = useCallback(async (address) => {
    if (!address) {
      setBalances([]);
      setTotalUsdValue(0);
      return;
    }

    setAssetsLoading(true);
    setError(null);

    try {
      // Normalize address - handle both string and object formats
      let normalizedAddress;
      if (typeof address === "string") {
        normalizedAddress = address.trim();
      } else if (address && typeof address === "object") {
        // Handle wallet adapter address objects (AccountAddress type)
        // Try common methods to extract address string
        if (address.toString) {
          normalizedAddress = address.toString();
        } else if (address.hex) {
          normalizedAddress = address.hex();
        } else if (address.data && typeof address.data === "object") {
          // Handle Uint8Array - convert to hex string
          const hex = Array.from(address.data)
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
          normalizedAddress = `0x${hex}`;
        } else {
          // Fallback: try to stringify and extract
          normalizedAddress = String(address);
        }
        // Ensure it's trimmed
        normalizedAddress = normalizedAddress.trim();
      } else {
        normalizedAddress = String(address).trim();
      }
      
      devLog("Fetching assets for address:", normalizedAddress);
      devLog("Original address type:", typeof address, address);
      devLog("Using RPC endpoint:", currentNetwork.rpc);
      
      // Always fetch from RPC (most reliable source)
      // Movement Network uses Aptos-compatible API
      const resources = await movementClient.getAccountResources({ 
        accountAddress: normalizedAddress 
      });
      
      devLog("=== BALANCE DEBUG ===");
      devLog("Normalized address:", normalizedAddress);
      devLog("RPC endpoint:", currentNetwork.rpc);
      devLog("RPC Resources fetched:", resources.length);
      devLog("All resource types:", resources.map(r => r.type).join("\n"));
      devLog("=== END DEBUG ===");
      
      // Filter for coin resources - Movement Network can have CoinStore in different modules
      // Standard: ::coin::CoinStore
      // Router: ::router::CoinStore
      // Others: Any module with CoinStore
      const coinResources = resources.filter((r) => 
        r.type.includes("CoinStore") && r.type.includes("<")
      );
      
      devLog("Coin resources found:", coinResources.length);
      
      // If no CoinStore found, log all resource types for debugging
      if (coinResources.length === 0) {
        console.warn("❌ NO COINSTORES FOUND!");
        console.warn("All resource types returned from RPC:");
        resources.forEach((r, idx) => {
          devLog(`  ${idx + 1}. ${r.type}`);
        });
        console.warn("This means either:");
        console.warn("  1. The RPC endpoint isn't returning coin resources");
        console.warn("  2. The wallet address is incorrect");
        console.warn("  3. The wallet has no tokens on this network");
        console.warn("  4. The wallet was just created and not indexed yet");
        
        // Check if there are any resources that might contain token data
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
          
          // If we found CoinStore resources but they weren't caught by our filter, log them
          const coinStoreResources = potentialTokenResources.filter(r => r.type.includes("CoinStore"));
          if (coinStoreResources.length > 0) {
            devLog("⚠️ Found CoinStore resources that should be processed:", coinStoreResources.map(r => ({
              type: r.type,
              data: r.data
            })));
          }
        }
      }
      
      // Log first coin resource structure for debugging
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

            // Log for debugging if we can't find the value
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

            // Try multiple price lookup strategies
            let price = 0;
            
            // 1. Try direct address lookup
            if (priceMap[tokenMeta.address]) {
              price = priceMap[tokenMeta.address];
            }
            // 2. Try symbol-based fallback for stablecoins
            else if (tokenMeta.symbol === "USDT" || tokenMeta.symbol === "USDC") {
              price = 1.0;
            }
            // 3. Try full type as fallback
            else {
              price = priceMap[tokenMeta.fullType] ?? 0;
            }
            
            const usdValue = quantity * price;

            // Smart formatting for different token types
            // High-value tokens (BTC, ETH) need more decimals for small amounts
            const isHighValueToken = ['BTC', 'WBTC', 'ETH', 'WETH'].includes(tokenMeta.symbol);
            
            // Format balance based on token type and amount
            let formattedAmount;
            if (isHighValueToken && quantity < 0.01) {
              // Very small BTC/ETH amounts - show up to 8 decimals
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 8,
              });
            } else if (isHighValueToken && quantity < 1) {
              // Small BTC/ETH amounts - show up to 6 decimals
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 6,
              });
            } else {
              // Normal formatting
              formattedAmount = quantity.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              });
            }

            // Format USD value - show more decimals for small values
            let formattedUsdValue;
            if (usdValue > 0 && usdValue < 0.01) {
              // Very small USD value - show up to 6 decimals
              formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 6,
              })}`;
            } else if (usdValue > 0 && usdValue < 1) {
              // Small USD value - show up to 4 decimals
              formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}`;
            } else {
              // Normal USD formatting
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

      // Only keep verified tokens from registry
      processed = processed.filter((t) => t && t.isKnown);

      devLog("Processed verified tokens:", processed.length);

      // Sort by USD value and calculate total
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
      
      // Provide user-friendly error message
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



  // Helper function to extract address string from account object
  const getAddressString = (accountObj) => {
    if (!accountObj || !accountObj.address) return null;
    
    const addr = accountObj.address;
    
    // If it's already a string, return it
    if (typeof addr === "string") {
      return addr.trim();
    }
    
    // If it's an AccountAddress object from Aptos SDK
    if (addr && typeof addr === "object") {
      try {
        // Try common methods first
        if (typeof addr.toString === "function" && addr.toString !== Object.prototype.toString) {
          const str = addr.toString();
          if (str && str.startsWith("0x")) {
            return str;
          }
        }
        if (typeof addr.hex === "function") {
          return addr.hex();
        }
        // Handle Uint8Array data
        if (addr.data) {
          let dataArray;
          if (addr.data instanceof Uint8Array) {
            dataArray = Array.from(addr.data);
          } else if (Array.isArray(addr.data)) {
            dataArray = addr.data;
          }
          
          if (dataArray && dataArray.length > 0) {
            // Convert Uint8Array to hex string
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
    
    // Fallback: try to stringify
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

  // Trigger Fetch when wallet connects/disconnects
  // Only reacts to actual wallet connect/disconnect events (account, connected)
  // NOT to location changes — URL-driven address is handled by the urlAddress effect above
  useEffect(() => {
    if (account && connected) {
      const addressString = getAddressString(account);
      devLog("=== WALLET CONNECTED ===");
      devLog("Extracted address string:", addressString);
      devLog("========================");
      
      if (addressString) {
        // Only auto-navigate to profile address if user isn't viewing a different searched address
        if (!urlAddress || urlAddress.toLowerCase() === addressString.toLowerCase()) {
          setViewingAddress(addressString);
          navigate(`/profile/${addressString}`, { replace: true });
          devLog("✅ Address set, indexer will fetch balances");
        }
      } else {
        console.error("Could not extract address from account object:", account);
        setError("Could not extract wallet address. Please try reconnecting.");
      }
    } else if (!connected) {
      // Only clear state if we're NOT viewing a searched address from URL
      if (!urlAddress) {
        setViewingAddress(null);
        setBalances([]);
        setTotalUsdValue(0);
        navigate('/', { replace: true });
      }
    }
  }, [account, connected, navigate, urlAddress]);

  // Close dropdown when clicking outside
  // Update balances when viewing address changes (for search)
  // Note: Removed fetchAssets call - indexer hook handles this automatically
  useEffect(() => {
    if (viewingAddress && (!account || viewingAddress !== account.address)) {
      devLog("📍 Viewing searched address:", viewingAddress, "(indexer will fetch)");
    }
  }, [viewingAddress, account]);

  // Use indexer balances when available (indexer is optimized for token queries)
  // Show balances IMMEDIATELY without waiting for prices - then update when prices arrive
  useEffect(() => {
    if (indexerLoading) {
      // Only show loading if we don't already have balances
      if (balances.length === 0) {
        setAssetsLoading(true);
      }
      devLog("⏳ Indexer loading...");
      return; // Early return - don't process yet
    }
    
    if (indexerError && viewingAddress) {
      console.warn("⚠️ Indexer error, trying RPC fallback:", indexerError);
      // Don't set error yet - try RPC fallback first
      fetchAssets(viewingAddress);
      return;
    }
    
    if (indexerBalances && indexerBalances.length > 0) {
      devLog("✅ Using indexer balances:", indexerBalances.length, "tokens");
      
      // Calculate total USD value with price map
      const withPrices = indexerBalances.map(balance => {
        // Try multiple price lookup strategies
        let price = 0;
        
        // 1. Try direct address lookup
        if (priceMap[balance.address]) {
          price = priceMap[balance.address];
        }
        // 2. Try symbol-based fallback for MOVE token
        else if (balance.symbol === "MOVE" || balance.symbol === "move") {
          // MOVE token - use 0xa price
          price = priceMap["0xa"] || priceMap["0x1"] || 0;
        }
        // 3. Try symbol-based fallback for stablecoins
        else if (balance.symbol === "USDT" || balance.symbol === "USDC") {
          price = 1.0;
        }
        // 4. Try full type as fallback
        else {
          price = priceMap[balance.fullType] ?? 0;
        }
        
        const usdValue = balance.numericAmount * price;
        
        // Smart formatting for USD value - show more decimals for small values
        let formattedUsdValue;
        if (usdValue > 0 && usdValue < 0.01) {
          // Very small USD value - show up to 6 decimals
          formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
            minimumFractionDigits: 4,
            maximumFractionDigits: 6,
          })}`;
        } else if (usdValue > 0 && usdValue < 1) {
          // Small USD value - show up to 4 decimals
          formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          })}`;
        } else {
          // Normal USD formatting
          formattedUsdValue = `$${usdValue.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`;
        }
        
        // Update amount formatting for high-value tokens if needed
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
      
      // Only keep verified tokens
      const verified = withPrices.filter((t) => t && t.isKnown);
      // Sort by USD value
      verified.sort((a, b) => b.usdValue - a.usdValue);
      // Recompute total based on verified set
      const totalUsd = verified.reduce((sum, t) => sum + (t.usdValue || 0), 0);
      
      setBalances(verified);
      setTotalUsdValue(totalUsd);
      setAssetsLoading(false);
      setError(null);
    } else if (indexerBalances && indexerBalances.length === 0 && !indexerLoading && viewingAddress) {
      // Indexer returned empty - try RPC fallback
      console.warn("⚠️ Indexer returned no balances, trying RPC fallback...");
      fetchAssets(viewingAddress);
    } else if (!indexerLoading && !viewingAddress) {
      // No address - clear loading state
      setAssetsLoading(false);
    }
  }, [indexerBalances, indexerLoading, indexerError, priceMap, viewingAddress, fetchAssets, balances.length]);

  // Detect LP (Liquidity Pool) positions from indexer balances and NFT holdings
  // NOTE: Only includes actual LP tokens, not lending receipts (those are in DeFi Positions)
  // Yuzu uses NFT-based position tokens for concentrated liquidity
  useEffect(() => {
    let cancelled = false;
    const detectLPPositions = async () => {
      const lpPositions = [];

      // 1. Detect fungible LP tokens from indexer balances
      if (indexerBalances && indexerBalances.length > 0) {
        // LP token patterns to detect (only actual liquidity pool tokens)
        const LP_PATTERNS = [
          // Canopy liquid staking vault tokens (liquid staking = providing liquidity)
          { pattern: /cvMOVE|cvUSDC|cvUSDT|cvWBTC|cvWETH/i, protocol: 'canopy', underlying: 'MOVE' },
          { pattern: /stMOVE|StakedMove/i, protocol: 'canopy', underlying: 'MOVE' },
          // Meridian LP tokens - mark as needing pool composition lookup
          { pattern: /MER-LP|Meridian LP/i, protocol: 'meridian', underlying: 'MERIDIAN_LP' },
          // Yuzu fungible LP tokens (if any)
          { pattern: /YuzuLP|Yuzu-LP/i, protocol: 'yuzu', underlying: 'LP' },
        ];

        // For Meridian LP tokens, collect composition data from positions hook
        let meridianCompositions = [];
        if (positions && positions.length > 0) {
          devLog('🔷 All positions from hook:', positions.map(p => ({ id: p.id, protocolName: p.protocolName, type: p.type, liquidityX: p.liquidityX })));
          meridianCompositions = positions.filter(pos => 
            pos.protocolName === 'Meridian' && 
            (pos.liquidityX !== undefined || pos.liquidityY !== undefined || pos.liquidityTokens !== undefined || pos.stakedAmount !== undefined)
          );
          devLog('🔷 Meridian positions with composition:', meridianCompositions.length, 
            meridianCompositions.map(p => ({ liquidityX: p.liquidityX, liquidityY: p.liquidityY, liquidityTokens: p.liquidityTokens, tokenX: p.tokenX, tokenY: p.tokenY })));
        }

        // Track which Meridian LP token we're processing (to match with composition data)
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

        // Resolve Meridian pool reserves for exact token composition per LP token
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
            meridianPoolInfoByAddress[poolAddress] = await fetchMeridianPoolInfo(poolAddress);
          })
        );

        indexerBalances.forEach(balance => {
          const symbol = balance.symbol || '';
          const name = balance.name || '';
          
          for (const { pattern, protocol, underlying } of LP_PATTERNS) {
            if (pattern.test(symbol) || pattern.test(name)) {
              // Determine underlying asset from symbol
              let underlyingAsset = underlying;
              if (symbol.includes('USDC')) underlyingAsset = 'USDC.e';
              else if (symbol.includes('USDT')) underlyingAsset = 'USDT.e';
              else if (symbol.includes('WBTC') || symbol.includes('BTC')) underlyingAsset = 'WBTC.e';
              else if (symbol.includes('WETH') || symbol.includes('ETH')) underlyingAsset = 'WETH.e';
              else if (symbol.includes('MOVE') || symbol === 'lMOVE') underlyingAsset = 'MOVE';

              // Calculate USD value based on underlying asset price
              let usdValue = 0;
              const amount = balance.numericAmount || 0;
              
              if (priceMap && underlyingAsset !== 'MERIDIAN_LP') {
                if (underlyingAsset === 'MOVE' || symbol.includes('MOVE') || symbol.includes('stMOVE')) {
                  // cvMOVE, stMOVE = 1:1 with MOVE
                  const movePrice = priceMap['0xa'] || priceMap['0x1'] || 0;
                  usdValue = amount * movePrice;
                } else if (underlyingAsset === 'USDC.e' || underlyingAsset === 'USDT.e') {
                  // Stablecoins = 1:1 with USD
                  usdValue = amount;
                } else if (underlyingAsset === 'WBTC.e') {
                  // Find BTC price
                  const btcPrice = Object.entries(priceMap).find(([addr]) => 
                    addr.toLowerCase().includes('wbtc') || addr.toLowerCase().includes('btc')
                  )?.[1] || 95000; // Fallback BTC price
                  usdValue = amount * btcPrice;
                } else if (underlyingAsset === 'WETH.e') {
                  // Find ETH price
                  const ethPrice = Object.entries(priceMap).find(([addr]) => 
                    addr.toLowerCase().includes('weth') || addr.toLowerCase().includes('eth')
                  )?.[1] || 3500; // Fallback ETH price
                  usdValue = amount * ethPrice;
                }
              }
              // For Meridian LP, value will be 0 (Price N/A) since we need pool composition

              // For Meridian LP, use composition data from positions hook
              let meridianComposition = {};
              if (protocol === 'meridian' && meridianCompositions.length > 0) {
                // Use composition from the corresponding meridian position
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
                devLog('🔷 Adding Meridian LP #' + meridianLPIndex + ' with composition:', meridianComposition);
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
                        const stableSymbols = ['USDT', 'USDT.E', 'USDC', 'USDC.E', 'USDA', 'USDE'];
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
                      console.warn('⚠️ Meridian pool token mismatch, skipping pool override', {
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
              break; // Found a match, stop checking patterns
            }
          }
        });
      }

      // 2. Detect Yuzu NFT-based LP positions
      // Yuzu uses concentrated liquidity with Position NFTs
      if (viewingAddress) {
        try {
          // Fetch NFT holdings and Yuzu liquidity events in parallel
          const [nftHoldings, yuzuEvents] = await Promise.all([
            getUserNFTHoldings(viewingAddress),
            getYuzuLiquidityPositions(viewingAddress)
          ]);
          
          // Build a map of position_id -> liquidity data from events
          const yuzuLiquidityMap = {};
          for (const event of yuzuEvents) {
            try {
              const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
              if (data && data.position_id) {
                // Store the most recent liquidity data for each position
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
              // Skip malformed events
            }
          }
          devLog('🍋 Yuzu liquidity map from events:', yuzuLiquidityMap);
          
          // Filter for Yuzu position NFTs
          // Yuzu NFT manager address: 0x1d0434ae92598710f5ccbfbf51cf66cf2fe8ba8e77381bed92f45bb32d237bc2
          const YUZU_NFT_MANAGER = '0x1d0434ae92598710f5ccbfbf51cf66cf2fe8ba8e77381bed92f45bb32d237bc2';
          
          for (const nft of nftHoldings) {
            const collectionName = nft.current_token_data?.current_collection?.collection_name || '';
            const creatorAddress = nft.current_token_data?.current_collection?.creator_address || '';
            const tokenName = nft.current_token_data?.token_name || '';
            
            // Check if this is a Yuzu liquidity position NFT
            // Collection name contains "liquidity position" or creator is Yuzu NFT manager
            const isYuzuPosition = 
              collectionName.toLowerCase().includes('yuzu') ||
              collectionName.toLowerCase().includes('liquidity position') ||
              creatorAddress.toLowerCase() === YUZU_NFT_MANAGER;
            
            if (isYuzuPosition) {
              devLog("🍋 Processing Yuzu NFT:", { tokenName, collectionName, creatorAddress, tokenDataId: nft.token_data_id });
              
              // Token name IS the position ID (e.g., "2450", "9410", "61152")
              const positionId = tokenName;
              
              // IMPORTANT: The creatorAddress of the NFT collection IS the Yuzu pool address!
              // This is how Yuzu structures their position NFTs
              const poolAddress = creatorAddress;
              
              // Collection name format: "Yuzuswap liquidity position | USDC.e/USDT.e | fee: 100 | tick spacing: 2"
              // Or: "Yuzuswap liquidity position | MOVE/USDC.e | fee: 2500 | tick spacing: 50"
              let poolPair = 'LP Position';
              
              // Parse pool pair from collection name
              const collectionMatch = collectionName.match(/\|\s*([A-Za-z0-9.]+\/[A-Za-z0-9.]+)\s*\|/i);
              if (collectionMatch) {
                poolPair = collectionMatch[1].replace('/', ' / ');
                devLog("🍋 Parsed pool pair from collection:", poolPair);
              }
              
              devLog("🍋 Position info:", { positionId, poolPair, poolAddress: poolAddress.substring(0, 20) + '...' });
              
              // Fetch position value from Yuzu view function
              let liquidityValue = 0;
              let token0Amount = 0;
              let token1Amount = 0;
              
              // Get MOVE price with multiple fallbacks
              const getMovePrice = () => {
                if (!priceMap) return 0.5; // Default fallback
                return priceMap['0xa'] || priceMap['0x1'] || 
                  Object.entries(priceMap).find(([addr]) => 
                    addr.toLowerCase() === '0xa' || addr.toLowerCase() === '0x1'
                  )?.[1] || 0.5;
              };
              
              // Try view function with pool address (creatorAddress) and position ID
              if (poolAddress && positionId) {
                try {
                  devLog('🍋 Trying get_position_token_amounts with:', { poolAddress: poolAddress.substring(0, 20), positionId });
                  const response = await fetch(`${DEFAULT_NETWORK.rpc}/view`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      function: '0x46566b4a16a1261ab400ab5b9067de84ba152b5eb4016b217187f2a2ca980c5a::position_nft_manager::get_position_token_amounts',
                      type_arguments: [],
                      arguments: [poolAddress, positionId]
                    })
                  });
                  
                  if (response.ok) {
                    const result = await response.json();
                    devLog('🍋 Yuzu view function result:', result);
                    // Result is [amount_0, amount_1] in smallest units
                    if (Array.isArray(result) && result.length >= 2) {
                      // Parse token symbols from pool pair (e.g., "MOVE / USDC.e" -> ["MOVE", "USDC.e"])
                      const tokens = poolPair.split('/').map(t => t.trim().replace(/\.e$/, '').toUpperCase());
                      
                      // Helper to determine decimals for a token symbol
                      const getTokenDecimals = (symbol) => {
                        // Check common stablecoins (6 decimals)
                        if (['USDC', 'USDT', 'USDA', 'USDE', 'DAI'].includes(symbol)) {
                          return 6;
                        }
                        // Default to 8 decimals for other tokens (MOVE, WETH, WBTC, etc.)
                        return 8;
                      };
                      
                      const decimals0 = tokens[0] ? getTokenDecimals(tokens[0]) : 8;
                      const decimals1 = tokens[1] ? getTokenDecimals(tokens[1]) : 8;
                      
                      devLog('🍋 Token decimals:', { token0: tokens[0], decimals0, token1: tokens[1], decimals1 });
                      
                      token0Amount = Number(result[0]) / Math.pow(10, decimals0);
                      token1Amount = Number(result[1]) / Math.pow(10, decimals1);
                      
                      // Calculate USD value
                      const token0Symbol = tokens[0] || '';
                      const token1Symbol = tokens[1] || '';
                      const isStable0 = ['USDC', 'USDT', 'USDA', 'USDE', 'DAI'].includes(token0Symbol);
                      const isStable1 = ['USDC', 'USDT', 'USDA', 'USDE', 'DAI'].includes(token1Symbol);
                      
                      // Check if tokens are meme/unknown tokens (no price data)
                      const MEME_TOKENS = ['CAPY', 'MOVECAT', 'GMOVE', 'TUBI', 'GCAT'];
                      const isMeme0 = MEME_TOKENS.includes(token0Symbol);
                      const isMeme1 = MEME_TOKENS.includes(token1Symbol);
                      
                      // Only calculate USD value if we have price data for tokens
                      // Don't show value for pairs with meme tokens or unknown tokens
                      if (isMeme0 || isMeme1) {
                        // Meme token pair - don't calculate USD value
                        liquidityValue = 0;
                        devLog('🍋 Meme token detected, skipping USD calculation:', { token0Symbol, token1Symbol });
                      } else if (isStable0 && isStable1) {
                        // Pure stablecoin pair
                        liquidityValue = token0Amount + token1Amount;
                      } else if (token0Symbol === 'MOVE' && isStable1) {
                        // MOVE/stablecoin pair
                        const movePrice = getMovePrice();
                        liquidityValue = (token0Amount * movePrice) + token1Amount;
                        devLog('🍋 MOVE pair calculation (token0):', { token0Amount, movePrice, token1Amount, liquidityValue });
                      } else if (token1Symbol === 'MOVE' && isStable0) {
                        // stablecoin/MOVE pair
                        const movePrice = getMovePrice();
                        liquidityValue = token0Amount + (token1Amount * movePrice);
                        devLog('🍋 MOVE pair calculation (token1):', { token0Amount, token1Amount, movePrice, liquidityValue });
                      } else {
                        // Unknown pair without stablecoin reference - can't accurately price
                        liquidityValue = 0;
                        devLog('🍋 No stablecoin or known token for pricing, skipping USD calculation');
                      }
                      devLog('🍋 Yuzu position values:', { token0Amount, token1Amount, liquidityValue });
                    }
                  } else {
                    const errText = await response.text();
                    console.warn('🍋 Yuzu view function failed:', errText);
                  }
                } catch (err) {
                  console.warn('🍋 Failed to fetch Yuzu position value:', err);
                }
              }
              
              // Log final status
              if (liquidityValue === 0) {
                devLog('🍋 Yuzu position - value unavailable, showing as active position');
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
              
              devLog("🍋 Found Yuzu NFT position:", { positionId, poolPair, liquidityValue, token0Amount, token1Amount });
            }
          }
        } catch (error) {
          console.warn("Failed to fetch Yuzu NFT positions:", error);
        }
      }

      devLog("💧 Detected LP/Vault positions:", lpPositions.length);
      if (!cancelled) {
        setLiquidityPositions(lpPositions);
      }
    };

    detectLPPositions();
    return () => { cancelled = true; };
  }, [indexerBalances, viewingAddress, priceMap, positions, fetchMeridianPoolInfo]);

  // Fetch wallet age when viewingAddress changes
  useEffect(() => {
    const fetchWalletData = async () => {
      if (!viewingAddress) {
        setWalletAge(null);
        return;
      }

      try {
        // Fetch wallet age
        const ageData = await getWalletAge(viewingAddress);
        setWalletAge(ageData);
        devLog("📅 Wallet age data:", ageData);
      } catch (err) {
        console.warn("Failed to fetch wallet data:", err);
      }
    };

    fetchWalletData();
  }, [viewingAddress]);

  // Format wallet age as days
  const formatWalletAge = (ageData) => {
    if (!ageData?.firstTxTimestamp) return null;
    
    const firstDate = new Date(ageData.firstTxTimestamp);
    const now = new Date();
    const diffMs = now - firstDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays < 1) return "< 1";
    return diffDays.toString();
  };



  // Handlers

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

            {/* HERO - NET WORTH V3 - Reference Design */}

            <section className="hero-v3 fade-in">

              <div className="hero-v3-left">

                {/* User Profile Section */}
                {viewingAddress && (
                  <div className="hero-profile-section">
                    <div className="hero-profile-card">
                      {/* Profile Picture */}
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

                      {/* Social Links */}
                      <div className="hero-profile-socials-grid">
                        {userProfile?.twitter ? (
                          <a 
                            href={`https://twitter.com/${userProfile.twitter.replace('@', '')}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="hero-social-link"
                            title={`Twitter: @${userProfile.twitter.replace('@', '')}`}
                          >
                            <span className="hero-social-icon">𝕏</span>
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
                              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a11.955 11.955 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.153-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.36-1.37.2-.456-.134-.883-.414-1.289-.77-.147-.127-.336-.191-.52-.191-.055 0-.109.005-.163.013-.502.113-1.005.656-1.059 1.22 0 .57.38.85.583 1.027.378.338.884.592 1.297.637.502.038 1.091-.044 1.601-.135 1.027-.226 1.918-.779 2.425-1.779.29-.576.17-1.392.589-1.487z"/>
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
                      <>
                        <span className="hero-username-highlight">{userProfile.username}</span>'s net worth
                      </>
                    ) : 'Net Worth'}
                  </span>

                  <div className="hero-v3-value">

                    {assetsLoading ? <span className="pulse">Loading...</span> :

                     error ? <span style={{fontSize: "24px", opacity: 0.7}}>Error</span> :

                     <span>{formatCurrencyValue(convertUSD(combinedNetWorth))}</span>

                    }

                    {!assetsLoading && portfolio24hChange !== null && (

                      <span className={`hero-v3-change ${portfolio24hChange >= 0 ? 'positive' : 'negative'}`}>

                        {portfolio24hChange >= 0 ? '↑' : '↓'} {Math.abs(portfolio24hChange).toFixed(2)}%

                      </span>

                    )}

                  </div>

                  <div className="hero-v3-meta">
                    {viewingAddress ? (
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
                      <span className="hero-v3-label">No Wallet Connected</span>
                    )}
                  </div>

                  

                  {!assetsLoading && !error && (

                    <div className="hero-v3-stats">

                      <div className="hero-v3-stat">

                        <span className="hero-v3-stat-value">

                          {formatCurrencyValue(convertUSD(totalUsdValue))}

                        </span>

                        <span className="hero-v3-stat-label">Wallet Balance</span>

                      </div>

                      

                      <div className="hero-v3-stat">

                        <span className={`hero-v3-stat-value ${(defiNetValue + liquidityTotalValue) >= 0 ? 'positive' : 'negative'}`}>

                          {formatCurrencyValue(convertUSD(defiNetValue + liquidityTotalValue))}

                        </span>

                        <span className="hero-v3-stat-label">Utilized Balance</span>

                      </div>

                      {walletAge && formatWalletAge(walletAge) && (

                        <div className="hero-v3-stat wallet-age">

                        <span className="hero-v3-stat-value age">

                          {formatWalletAge(walletAge)}

                        </span>

                        <span className="hero-v3-stat-label">Wallet Age (Days)</span>

                      </div>

                    )}

                  </div>

                )}

                </div>

              </div>

              

              {error && <ErrorMessage message={error} onRetry={handleRefresh} />}

            </section>



            {/* BALANCES */}

            <section className="grid-section">

              <h3 className="section-title">Wallet balance</h3>

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

                  <div className="empty-state">Connect wallet to view your portfolio</div>

                )}

               

                {!assetsLoading && !error && balances.length === 0 && viewingAddress && (

                  <div className="empty-state">No tokens found in this wallet</div>

                )}



                {!assetsLoading && balances.map((token, index) => (

                  <TokenCard

                    key={token.id}

                    token={token}

                    delay={index * ANIMATION_DELAYS.TOKEN_CARD}

                    convertUSD={convertUSD}

                    formatCurrencyValue={formatCurrencyValue}

                  />

                ))}

              </div>

            </section>



            {/* DEFI POSITIONS */}

            <section className="grid-section">

              <h3 className="section-title">DeFi Positions</h3>

              <div className="grid-container">

                {defiLoading && (

                  <>

                    <SkeletonCard delay={0} />

                    <SkeletonCard delay={50} />

                  </>

                )}



                {!defiLoading && visibleDeFiPositions.length === 0 && viewingAddress && (

                    <div className="empty-state">No active DeFi positions found</div>

                )}

               

                {!defiLoading && visibleDeFiPositions.length === 0 && !viewingAddress && (

                    <div className="empty-state">Connect wallet to view DeFi positions</div>

                )}



                {!defiLoading && visibleDeFiPositions.length > 0 && (() => {
                    // Group positions by protocol
                  const groupedByProtocol = visibleDeFiPositions.reduce((acc, pos) => {
                      const key = pos.protocolName || 'Unknown';
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(pos);
                      return acc;
                    }, {});

                    const getProtocolPositionUsd = (pos) => {
                      if (!pos) return 0;

                      if (Number.isFinite(pos.usdValue) && pos.usdValue > 0) {
                        return pos.usdValue;
                      }

                      const amount = parseFloat(pos.value || 0);
                      if (!Number.isFinite(amount) || amount <= 0) return 0;

                      const symbol = (pos.tokenSymbol || '').toUpperCase();
                      const address = getTokenAddressBySymbol(symbol);

                      if (address && priceMap?.[address]) {
                        return amount * Number(priceMap[address]);
                      }

                      if (symbol === 'USDC' || symbol === 'USDT' || symbol === 'USDA' || symbol === 'USDE' || symbol === 'SUSDE') {
                        return amount;
                      }

                      return 0;
                    };

                    const sortedProtocolEntries = Object.entries(groupedByProtocol)
                      .map(([protocolName, protocolPositions]) => {
                        const netUsd = protocolPositions.reduce((sum, pos) => {
                          const usdValue = getProtocolPositionUsd(pos);
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
                      />
                    ));
                })()}

              </div>

            </section>

            {/* LIQUIDITY POSITIONS */}
            <section className="grid-section">
              <h3 className="section-title">
                <span></span> Liquidity Positions
              </h3>
              <div className="grid-container lp-grid">
                {indexerLoading && (
                  <>
                    <SkeletonCard delay={0} />
                    <SkeletonCard delay={50} />
                  </>
                )}

                {!indexerLoading && liquidityPositions.length === 0 && viewingAddress && (
                  <div className="empty-state">No liquidity positions found</div>
                )}
                
                {!indexerLoading && liquidityPositions.length === 0 && !viewingAddress && (
                  <div className="empty-state">Connect wallet to view liquidity positions</div>
                )}

                {!indexerLoading && liquidityPositions.length > 0 && liquidityPositions.map((position, index) => (
                  <LiquidityCard
                    key={position.id}
                    position={position}
                    delay={index * ANIMATION_DELAYS.TOKEN_CARD}
                    priceMap={priceMap}
                    convertUSD={convertUSD}
                    formatCurrencyValue={formatCurrencyValue}
                    currencySymbol={currencySymbol}
                  />
                ))}
              </div>
            </section>

        {/* Profile Modal */}
        {showProfileModal && (
          <div className="profile-modal-overlay" onClick={() => setShowProfileModal(false)}>
            <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowProfileModal(false)}>×</button>
              
              <div className="profile-modal-content">
                <div className="profile-modal-main">
                  {/* Profile Picture */}
                  <div className="modal-avatar-section">
                    <img 
                      src={modalAvatarSrc} 
                      alt="User" 
                      className="modal-avatar-image" 
                    />
                  </div>

                  {/* User Info */}
                  <div className="modal-info-section">
                    <h2 className="modal-username">{userProfile?.username || 'Anonymous User'}</h2>
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
                        Edit Profile
                      </button>
                    )}
                  </div>

                  {/* Level Details Section */}
                  {!levelLoading && (
                    <div className="modal-level-section">
                      <div className="modal-level-row">
                        <span className="modal-level-label">Current Level</span>
                        <span className="modal-level-value">{level}</span>
                      </div>
                      <div className="modal-xp-row">
                        <span className="modal-xp-label">Experience Points</span>
                        <span className="modal-xp-value">{xp} / {nextLevelXP}</span>
                      </div>
                      <div className="modal-xp-bar-container">
                        <div className="modal-xp-bar-fill" style={{ width: `${xpProgress}%` }} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Badges Section */}
                <div className="modal-badges-section">
                  <h3 className="modal-badges-title">Collected Badges ({userBadges.length})</h3>

                  {/* On-chain badges (available in module) */}
                  <div className="modal-onchain-badges">
                    <h4 className="modal-onchain-title">Available Badges</h4>
                    {onchainBadgesLoading ? (
                      <div className="modal-onchain-loading">Loading badges...</div>
                    ) : onchainBadges && onchainBadges.length > 0 ? (
                      <div className="modal-onchain-badges-grid">
                        {onchainBadges.map((b) => (
                          <div key={b.id} className={`modal-onchain-badge ${b.earned ? 'owned' : 'locked'}`}>
                            <div className="modal-onchain-badge-icon">{b.imageUrl ? <img src={b.imageUrl} alt={b.name} onError={(e)=>{e.target.style.display='none'}}/> : (b.name ? b.name[0] : '🏅')}</div>
                            <div className="modal-onchain-badge-info">
                              <div className="modal-onchain-badge-name">{b.name}</div>
                              <div className="modal-onchain-badge-meta">{b.earned ? 'Owned' : 'Not owned'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="modal-onchain-empty">No on-chain badges</div>
                    )}
                  </div>
                  {(persistedBadges && persistedBadges.length > 0) || userBadges.length > 0 ? (
                    <div className="modal-badges-grid">
                      {(persistedBadges && persistedBadges.length > 0 ? persistedBadges : userBadges).map(badge => (
                        <div key={badge.id} className="modal-badge-item">
                          <div className="modal-badge-icon-box">
                            <span className="modal-badge-icon">{badge.icon || '🏆'}</span>
                          </div>
                          <div className="modal-badge-info">
                            <div className="modal-badge-name">{badge.name}</div>
                            <div className="modal-badge-description">{badge.description}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="modal-no-badges">No badges earned yet. Mint badges to level up!</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        </>

  );

};



// --- APP WRAPPER ---

const App = () => {

  const wallets = useMemo(() => [new PetraWallet(), new OKXWallet()], []);

  useEffect(() => {
    const syncTheme = () => {
      const preference = getStoredThemePreference();
      applyTheme(preference);
    };

    syncTheme();

    const onStorage = (event) => {
      if (!event?.key || event.key === "theme" || event.key === "settings_global" || event.key.startsWith("settings_")) {
        syncTheme();
      }
    };

    window.addEventListener("storage", onStorage);

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMediaChange = () => {
      if (getStoredThemePreference() === "auto") {
        syncTheme();
      }
    };

    media?.addEventListener?.("change", onMediaChange);

    return () => {
      window.removeEventListener("storage", onStorage);
      media?.removeEventListener?.("change", onMediaChange);
    };
  }, []);

  return (

    <ErrorBoundary>

      <AptosWalletAdapterProvider plugins={wallets} autoConnect={true}>

        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Home />
              </Suspense>
            }
          />
          <Route
            path="/*"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Layout>
                  <Routes>
                    <Route path="/wallet/:address" element={<WalletRedirect />} />
                    <Route path="/profile/:address" element={<Dashboard />} />
                    <Route
                      path="/swap"
                      element={SWAP_ENABLED ? <SwapPageWrapper /> : <Navigate to="/" replace />}
                    />
                    <Route path="/badges" element={<Badges />} />
                    <Route path="/leaderboard" element={<Leaderboard />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/profile/:address" element={<ProfileView />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="/more" element={<More />} />
                    <Route path="/level" element={<Level />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/privacy" element={<Privacy />} />
                  </Routes>
                </Layout>
              </Suspense>
            }
          />
        </Routes>

      </AptosWalletAdapterProvider>

    </ErrorBoundary>

  );

};

// Wrapper to get balances for SwapPage
const SwapPageWrapper = () => {
  const { account, connected } = useWallet();
  const walletAddress = connected && account
    ? (typeof account.address === 'string' ? account.address : account.address?.toString?.())
    : null;
  const { balances, refetch } = useIndexerBalances(walletAddress);

  return <SwapPage balances={balances || []} onSwapSuccess={refetch} />;
};



export default App;