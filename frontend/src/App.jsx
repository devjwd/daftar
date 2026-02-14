import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Routes, Route, useNavigate, useLocation, useParams } from "react-router-dom";
import "./App.css";



// --- IMPORTS ---

const logo = "/logo.png";



// Movement / Aptos SDKs

import { AptosWalletAdapterProvider, useWallet } from "@aptos-labs/wallet-adapter-react";

import { PetraWallet } from "petra-plugin-wallet-adapter";

import { OKXWallet } from "@okwallet/aptos-wallet-adapter";

import { Aptos, AptosConfig, Network, AccountAddress } from "@aptos-labs/ts-sdk";



// Utils & Config

import { DEFAULT_NETWORK } from "./config/network";

import { INTERVALS, FORMATTING, ANIMATION_DELAYS } from "./config/constants";

import { parseCoinType, getTokenDecimals, formatAddress, isValidAddress } from "./utils/tokenUtils";

import { getTokenInfo } from "./config/tokens";

import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";



// Hooks
import { useDeFiPositions } from "./hooks/useDeFiPositions";
import { useTokenPrices } from "./hooks/useTokenPrices";
import { useIndexerBalances } from "./hooks/useIndexerBalances";
import { useProfile } from "./hooks/useProfile";
import { useCurrency } from "./hooks/useCurrency";

// Indexer services
import { getWalletAge, getRecentTransactions, getUserNFTHoldings, getYuzuLiquidityPositions } from "./services/indexer";

// Components
import Swap from "./components/Swap";
import SwapPage from "./pages/Swap";
import Home from "./pages/Home";
import Profile from "./pages/Profile";
import ProfileView from "./pages/ProfileView";
import Settings from "./pages/Settings";
import Badges from "./pages/Badges";
import Leaderboard from "./pages/Leaderboard";
import Admin from "./pages/Admin";
import More from "./pages/More";
import ProfileCard from "./components/ProfileCard";




// --- COMPONENT: Token Card ---

const TokenCard = ({ token, delay, convertUSD, formatCurrencyValue }) => {
  const tokenInfo = getTokenInfo(token.address);
  const isKnownToken = !!tokenInfo;
  
  // Token logo mapping
  const TOKEN_LOGOS = {
    'MOVE': '/movement-logo.svg',
    'USDC': '/usdc.png',
    'USDT': '/usdt.png',
    'ETH': '/ETH.png',
    'WETH': '/ETH.png',
    'BTC': '/BTC.png',
    'WBTC': '/BTC.png',
    'CAPY': '/capy.png',
    'MOVECAT': '/movecat.jfif',
    'LBTC': '/LBTC.webp',
    'EZETH': '/ezETH.webp',
    'RSETH': '/rsETH.webp',
    'SOLVBTC': '/SolvBTC.webp',
    'USDE': '/USDe.webp',
    'USDA': '/USDa.webp',
    'WEETH': '/weETH.webp',
  };

  // Token colors for gradient effects
  const TOKEN_COLORS = {
    'MOVE': { primary: '#d4a574', secondary: '#e5c9a8' },
    'USDC': { primary: '#2775ca', secondary: '#5a9fd4' },
    'USDT': { primary: '#26a17b', secondary: '#4ecda0' },
    'ETH': { primary: '#627eea', secondary: '#8fa3ef' },
    'WETH': { primary: '#627eea', secondary: '#8fa3ef' },
    'BTC': { primary: '#f7931a', secondary: '#ffb84d' },
    'WBTC': { primary: '#f7931a', secondary: '#ffb84d' },
    'CAPY': { primary: '#ff6b9d', secondary: '#ff9ec4' },
    'MOVECAT': { primary: '#9b59b6', secondary: '#c39bd3' },
    'LBTC': { primary: '#f7931a', secondary: '#ffb84d' }, // BTC orange
    'EZETH': { primary: '#00d395', secondary: '#4eebb3' }, // Renzo green
    'RSETH': { primary: '#4caf50', secondary: '#81c784' }, // Kelp green
    'SOLVBTC': { primary: '#f7931a', secondary: '#ffc107' }, // Solv BTC orange
    'USDE': { primary: '#171717', secondary: '#3d3d3d' }, // Ethena dark
    'USDA': { primary: '#2196f3', secondary: '#64b5f6' }, // Angle blue
    'WEETH': { primary: '#7c3aed', secondary: '#a78bfa' }, // EtherFi purple
  };

  const symbol = (token.symbol || '').toUpperCase();
  // Strip .E suffix for logo/color lookup (e.g., WETH.E -> WETH, USDC.E -> USDC)
  const baseSymbol = symbol.replace(/\.E$/i, '');
  const tokenLogo = TOKEN_LOGOS[baseSymbol] || TOKEN_LOGOS[symbol] || null;
  const tokenColor = TOKEN_COLORS[baseSymbol] || TOKEN_COLORS[symbol] || { primary: '#d4a574', secondary: '#e5c9a8' };

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
  // Protocol logo and name mapping
  const PROTOCOL_DATA = {
    echelon: { logo: '/Echelon.png', name: 'Echelon Finance', color: '#6366f1', gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)' },
    joule: { logo: '/joule-finance.png', name: 'Joule Finance', color: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)' },
    moveposition: { logo: '/moveposition.png', name: 'MovePosition', color: '#10b981', gradient: 'linear-gradient(135deg, #10b981, #34d399)' },
    meridian: { logo: '/Meridian.png', name: 'Meridian', color: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
    canopy: { logo: '/canopy.png', name: 'Canopy', color: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e, #4ade80)' },
    layerbank: { logo: '/LayerBank.png', name: 'LayerBank', color: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
    mosaic: { logo: '/mosaic.png', name: 'Mosaic', color: '#06b6d4', gradient: 'linear-gradient(135deg, #06b6d4, #22d3ee)' },
    yuzu: { logo: '/yuzu.png', name: 'Yuzu Swap', color: '#eab308', gradient: 'linear-gradient(135deg, #eab308, #facc15)' },
  };

  // Token address mapping for price lookup
  const TOKEN_ADDRESSES = {
    'MOVE': '0xa',
    'USDC': '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39',
    'USDT': '0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d',
    'WETH': '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376',
    'WBTC': '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c',
    'ETH': '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376',
    'BTC': '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c',
  };

  // Get token price
  const getTokenPrice = (symbol) => {
    if (!priceMap) return 0;
    const upperSymbol = (symbol || '').toUpperCase();
    // Try direct symbol lookup in priceMap
    const address = TOKEN_ADDRESSES[upperSymbol];
    if (address && priceMap[address]) return priceMap[address];
    // Stablecoin fallback
    if (upperSymbol === 'USDC' || upperSymbol === 'USDT') return 1.0;
    return 0;
  };

  // Get protocol info from first position
  const firstPos = protocolPositions[0];
  const getProtocolKey = () => {
    const searchText = `${firstPos.name} ${firstPos.protocolName || ''} ${firstPos.resourceType || ''}`.toLowerCase();
    for (const key of Object.keys(PROTOCOL_DATA)) {
      if (searchText.includes(key)) return key;
    }
    return null;
  };

  const protocolKey = getProtocolKey();
  const protocol = protocolKey ? PROTOCOL_DATA[protocolKey] : { 
    logo: '/movement-logo.svg', 
    name: firstPos.protocolName || 'DeFi Protocol', 
    color: '#d4a574',
    gradient: 'linear-gradient(135deg, #d4a574, #e5c9a8)'
  };

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
            <span className="defi-v2-column-icon">📈</span>
            <span className="defi-v2-column-label">Supplied</span>
            <span className="defi-v2-column-total">{formatUsdValue(totalSupplyUsd)}</span>
          </div>
          <div className="defi-v2-column-items">
            {supplyPositions.length > 0 ? supplyPositions.map((pos, idx) => (
              <div key={idx} className="defi-v2-item">
                <span className="defi-v2-item-token">{pos.tokenSymbol || 'Token'}</span>
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
            <span className="defi-v2-column-icon">💳</span>
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
    color: '#d4a574',
    gradient: 'linear-gradient(135deg, #d4a574, #e5c9a8)',
    type: 'LP Token',
    website: null
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
          <h4 className="lp-card-name">{protocol.name}</h4>
          <div className="lp-card-type-row">
            <span className="lp-card-type">{protocol.type}</span>
            {isCanopyDeposit && position.protocol !== 'canopy' && (
              <span className="lp-card-tag canopy">via Canopy</span>
            )}
          </div>
        </div>
        <div className="lp-card-actions">
          <div className="lp-card-badge">
            <span>{position.symbol}</span>
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
      </div>

      {/* Body */}
      <div className="lp-card-body">
        <div className="lp-card-stats-row">
          <div className="lp-card-stat">
            <span className="lp-card-stat-label">{position.isNFT ? 'Pool' : 'Balance'}</span>
            <span className="lp-card-stat-value">
              {position.isNFT ? position.name : formatValue(position.amount)}
            </span>
          </div>
          <div className="lp-card-stat">
            <span className="lp-card-stat-label">Liquidity</span>
            <span className="lp-card-stat-value highlight">
              {usdValue > 0 ? formatUsd(usdValue) : 'Price N/A'}
            </span>
          </div>
        </div>
        
        {/* Show token amounts for Yuzu NFT positions */}
        {position.isNFT && position.protocol === 'yuzu' && (position.token0Amount > 0 || position.token1Amount > 0) && (
          <div className="lp-card-stat lp-card-token-amounts">
            <span className="lp-card-stat-label">Token Amounts</span>
            <span className="lp-card-stat-value small">
              {position.token0Amount > 0 && `${formatValue(position.token0Amount)} ${position.name?.split(' / ')[0] || 'Token0'}`}
              {position.token0Amount > 0 && position.token1Amount > 0 && ' + '}
              {position.token1Amount > 0 && `${formatValue(position.token1Amount)} ${position.name?.split(' / ')[1] || 'Token1'}`}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="lp-card-footer">
        <div className="lp-card-underlying">
          <span className="lp-card-underlying-label">
            {position.isNFT ? 'Position' : 'Underlying Asset'}
          </span>
          <span className="lp-card-underlying-value">
            {position.isNFT 
              ? `#${position.positionId || position.tokenDataId?.slice(-8) || 'NFT'}` 
              : (position.underlying || position.symbol?.replace('cv', '').replace('l', '') || 'MOVE')}
          </span>
        </div>
        <div className="lp-card-badges">
          {position.isNFT && (
            <div className="lp-card-nft-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              <span>NFT Position</span>
            </div>
          )}
          {isCanopyDeposit && (
            <div className="lp-card-canopy-badge">
              <img src="/canopy.png" alt="Canopy" onError={(e) => { e.target.style.display = 'none'; }} />
              <span>Canopy</span>
            </div>
          )}
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



// --- MAIN DASHBOARD ---

const Dashboard = () => {

  const { connect, disconnect, account, connected, wallets } = useWallet();
  const navigate = useNavigate();
  const location = useLocation();
  const { address: urlAddress } = useParams();
 
  // State

  const [balances, setBalances] = useState([]);

  const [assetsLoading, setAssetsLoading] = useState(false);

  const [error, setError] = useState(null);

  const [totalUsdValue, setTotalUsdValue] = useState(0);

  const [viewingAddress, setViewingAddress] = useState(null);

  const [networkStatus, setNetworkStatus] = useState("checking");

  const [walletAge, setWalletAge] = useState(null); // { firstTxTimestamp, txCount }
  const [liquidityPositions, setLiquidityPositions] = useState([]); // LP/Vault positions
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Badges data
  const badges = [
    { id: 1, name: 'Early Member', icon: '⭐', earned: true },
    { id: 2, name: 'Whale Hunter', icon: '🐋', earned: false },
    { id: 3, name: 'DeFi Enthusiast', icon: '🚀', earned: true },
    { id: 4, name: 'Liquidity Provider', icon: '💧', earned: false },
    { id: 5, name: 'Portfolio Master', icon: '👑', earned: false },
    { id: 6, name: 'Lending Guru', icon: '💰', earned: true }
  ];

  // Custom Hooks - pass viewingAddress to support address search
  const { positions, loading: defiLoading, error: defiError, refetch: refetchDefi } = useDeFiPositions(viewingAddress);
  const { prices: priceMap, priceChanges } = useTokenPrices();
  const { currency, convertUSD, formatValue: formatCurrencyValue, currencySymbol } = useCurrency();
  
  // Use indexer for balances (optimized for token queries)
  const { 
    balances: indexerBalances, 
    loading: indexerLoading, 
    error: indexerError,
    refetch: refetchIndexer 
  } = useIndexerBalances(viewingAddress);

  // Use profile hook to get user profile data
  const { profile: userProfile } = useProfile(viewingAddress);

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
      navigate(`/wallet/${addressParam}`, { replace: true });
    }
  }, [location.search, navigate]);

  // Config
  const currentNetwork = DEFAULT_NETWORK;
  const movementClient = useMemo(() => new Aptos(new AptosConfig({

      network: Network.CUSTOM,

      fullnode: currentNetwork.rpc

  })), [currentNetwork]);

  // Token address mapping for DeFi price lookup
  const TOKEN_ADDRESSES = useMemo(() => ({
    'MOVE': '0xa',
    'USDC': '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39',
    'USDT': '0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d',
    'WETH': '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376',
    'WBTC': '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c',
    'ETH': '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376',
    'BTC': '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c',
  }), []);

  // Calculate total DeFi net value (supply - debt) in USD
  const defiNetValue = useMemo(() => {
    if (!positions || positions.length === 0 || !priceMap) return 0;
    
    const getTokenPrice = (symbol) => {
      const upperSymbol = (symbol || '').toUpperCase();
      const address = TOKEN_ADDRESSES[upperSymbol];
      if (address && priceMap[address]) return priceMap[address];
      if (upperSymbol === 'USDC' || upperSymbol === 'USDT') return 1.0;
      return 0;
    };
    
    let totalSupply = 0;
    let totalDebt = 0;
    
    positions.forEach(pos => {
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
  }, [positions, priceMap, TOKEN_ADDRESSES]);

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

  // Network Health

  useEffect(() => {

    const checkNetworkHealth = async () => {

      try {

        const ledgerInfo = await movementClient.getLedgerInfo();

        setNetworkStatus(ledgerInfo ? "online" : "offline");

      } catch (_e) {

        setNetworkStatus("offline");

      }

    };

    checkNetworkHealth();

    const interval = setInterval(checkNetworkHealth, INTERVALS.NETWORK_CHECK);

    return () => clearInterval(interval);

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
      
      console.log("Fetching assets for address:", normalizedAddress);
      console.log("Original address type:", typeof address, address);
      console.log("Using RPC endpoint:", currentNetwork.rpc);
      
      // Always fetch from RPC (most reliable source)
      // Movement Network uses Aptos-compatible API
      const resources = await movementClient.getAccountResources({ 
        accountAddress: normalizedAddress 
      });
      
      console.log("=== BALANCE DEBUG ===");
      console.log("Normalized address:", normalizedAddress);
      console.log("RPC endpoint:", currentNetwork.rpc);
      console.log("RPC Resources fetched:", resources.length);
      console.log("All resource types:", resources.map(r => r.type).join("\n"));
      console.log("=== END DEBUG ===");
      
      // Filter for coin resources - Movement Network can have CoinStore in different modules
      // Standard: ::coin::CoinStore
      // Router: ::router::CoinStore
      // Others: Any module with CoinStore
      const coinResources = resources.filter((r) => 
        r.type.includes("CoinStore") && r.type.includes("<")
      );
      
      console.log("Coin resources found:", coinResources.length);
      
      // If no CoinStore found, log all resource types for debugging
      if (coinResources.length === 0) {
        console.warn("❌ NO COINSTORES FOUND!");
        console.warn("All resource types returned from RPC:");
        resources.forEach((r, idx) => {
          console.log(`  ${idx + 1}. ${r.type}`);
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
          console.log("Found potential token-related resources:", potentialTokenResources.map(r => ({
            type: r.type,
            hasData: !!r.data,
            dataKeys: r.data ? Object.keys(r.data) : []
          })));
          
          // If we found CoinStore resources but they weren't caught by our filter, log them
          const coinStoreResources = potentialTokenResources.filter(r => r.type.includes("CoinStore"));
          if (coinStoreResources.length > 0) {
            console.log("⚠️ Found CoinStore resources that should be processed:", coinStoreResources.map(r => ({
              type: r.type,
              data: r.data
            })));
          }
        }
      }
      
      // Log first coin resource structure for debugging
      if (coinResources.length > 0) {
        console.log("Sample coin resource:", {
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
            let coinValue = "0";
            
            // Try different data structures (Movement/Aptos can return various formats)
            // Movement Network uses Aptos-compatible structure: coin.data.coin.value
            if (coin.data) {
              // Most common format: coin.data.coin.value (Aptos/Movement standard)
              if (coin.data.coin !== undefined) {
                if (coin.data.coin.value !== undefined) {
                  coinValue = String(coin.data.coin.value);
                } else if (coin.data.coin.amount !== undefined) {
                  coinValue = String(coin.data.coin.amount);
                } else if (typeof coin.data.coin === "string" || typeof coin.data.coin === "number" || typeof coin.data.coin === "bigint") {
                  coinValue = String(coin.data.coin);
                }
              }
              // Alternative: coin.data.value (direct value)
              else if (coin.data.value !== undefined) {
                coinValue = String(coin.data.value);
              }
              // Direct string/number value
              else if (typeof coin.data === "string" || typeof coin.data === "number" || typeof coin.data === "bigint") {
                coinValue = String(coin.data);
              }
              
              // If still no value found, log the structure for debugging
              if (!coinValue || coinValue === "0" || coinValue === "undefined") {
                console.warn("Coin data structure:", {
                  type: coin.type,
                  data: coin.data,
                  dataKeys: Object.keys(coin.data || {}),
                  coinKeys: coin.data?.coin ? Object.keys(coin.data.coin) : null
                });
              }
            }

            // Log for debugging if we can't find the value
            if (!coinValue || coinValue === "0" || coinValue === "undefined" || coinValue === "null") {
              console.warn("Could not extract coin value for:", coin.type);
              console.warn("Full coin data:", JSON.stringify(coin.data, null, 2));
              return null;
            }
            
            console.log(`Processing ${tokenMeta.symbol}: raw=${coinValue}, decimals=${decimals}`);

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
            // 2. Try normalized short address (0xa, 0x1)
            else if (tokenMeta.address.length <= 4 && priceMap[tokenMeta.address]) {
              price = priceMap[tokenMeta.address];
            }
            // 3. Try symbol-based fallback for stablecoins
            else if (tokenMeta.symbol === "USDT" || tokenMeta.symbol === "USDC") {
              price = 1.0;
            }
            // 4. Try full type as fallback
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

      console.log("Processed verified tokens:", processed.length);

      // Sort by USD value and calculate total
      processed.sort((a, b) => b.usdValue - a.usdValue);
      const totalUsd = processed.reduce((sum, token) => sum + token.usdValue, 0);

      console.log("Total USD value (verified):", totalUsd);

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
  }, [movementClient, priceMap, currentNetwork]);



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

  // Trigger Fetch when wallet connects/disconnects
  // Only reacts to actual wallet connect/disconnect events (account, connected)
  // NOT to location changes — URL-driven address is handled by the urlAddress effect above
  useEffect(() => {
    if (account && connected) {
      const addressString = getAddressString(account);
      console.log("=== WALLET CONNECTED ===");
      console.log("Extracted address string:", addressString);
      console.log("========================");
      
      if (addressString) {
        // Only auto-navigate to wallet address if user isn't viewing a different searched address
        if (!urlAddress || urlAddress.toLowerCase() === addressString.toLowerCase()) {
          setViewingAddress(addressString);
          navigate(`/wallet/${addressString}`, { replace: true });
          console.log("✅ Address set, indexer will fetch balances");
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
      console.log("📍 Viewing searched address:", viewingAddress, "(indexer will fetch)");
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
      console.log("⏳ Indexer loading...");
      return; // Early return - don't process yet
    }
    
    if (indexerError && viewingAddress) {
      console.warn("⚠️ Indexer error, trying RPC fallback:", indexerError);
      // Don't set error yet - try RPC fallback first
      fetchAssets(viewingAddress);
      return;
    }
    
    if (indexerBalances && indexerBalances.length > 0) {
      console.log("✅ Using indexer balances:", indexerBalances.length, "tokens");
      
      // Calculate total USD value with price map
      const withPrices = indexerBalances.map(balance => {
        // Try multiple price lookup strategies
        let price = 0;
        
        // 1. Try direct address lookup
        if (priceMap[balance.address]) {
          price = priceMap[balance.address];
        }
        // 2. Try normalized short address (0xa, 0x1)
        else if (balance.address && balance.address.length <= 4 && priceMap[balance.address]) {
          price = priceMap[balance.address];
        }
        // 3. Try symbol-based fallback for MOVE token
        else if (balance.symbol === "MOVE" || balance.symbol === "move") {
          // MOVE token - use 0xa price
          price = priceMap["0xa"] || priceMap["0x1"] || 0;
        }
        // 4. Try symbol-based fallback for stablecoins
        else if (balance.symbol === "USDT" || balance.symbol === "USDC") {
          price = 1.0;
        }
        // 5. Try full type as fallback
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
            } catch (_e) {
              // Skip malformed events
            }
          }
          console.log('🍋 Yuzu liquidity map from events:', yuzuLiquidityMap);
          
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
              console.log("🍋 Processing Yuzu NFT:", { tokenName, collectionName, creatorAddress, tokenDataId: nft.token_data_id });
              
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
                console.log("🍋 Parsed pool pair from collection:", poolPair);
              }
              
              console.log("🍋 Position info:", { positionId, poolPair, poolAddress: poolAddress.substring(0, 20) + '...' });
              
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
                  console.log('🍋 Trying get_position_token_amounts with:', { poolAddress: poolAddress.substring(0, 20), positionId });
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
                    console.log('🍋 Yuzu view function result:', result);
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
                      
                      console.log('🍋 Token decimals:', { token0: tokens[0], decimals0, token1: tokens[1], decimals1 });
                      
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
                        console.log('🍋 Meme token detected, skipping USD calculation:', { token0Symbol, token1Symbol });
                      } else if (isStable0 && isStable1) {
                        // Pure stablecoin pair
                        liquidityValue = token0Amount + token1Amount;
                      } else if (token0Symbol === 'MOVE' && isStable1) {
                        // MOVE/stablecoin pair
                        const movePrice = getMovePrice();
                        liquidityValue = (token0Amount * movePrice) + token1Amount;
                        console.log('🍋 MOVE pair calculation (token0):', { token0Amount, movePrice, token1Amount, liquidityValue });
                      } else if (token1Symbol === 'MOVE' && isStable0) {
                        // stablecoin/MOVE pair
                        const movePrice = getMovePrice();
                        liquidityValue = token0Amount + (token1Amount * movePrice);
                        console.log('🍋 MOVE pair calculation (token1):', { token0Amount, token1Amount, movePrice, liquidityValue });
                      } else {
                        // Unknown pair without stablecoin reference - can't accurately price
                        liquidityValue = 0;
                        console.log('🍋 No stablecoin or known token for pricing, skipping USD calculation');
                      }
                      console.log('🍋 Yuzu position values:', { token0Amount, token1Amount, liquidityValue });
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
                console.log('🍋 Yuzu position - value unavailable, showing as active position');
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
              
              console.log("🍋 Found Yuzu NFT position:", { positionId, poolPair, liquidityValue, token0Amount, token1Amount });
            }
          }
        } catch (error) {
          console.warn("Failed to fetch Yuzu NFT positions:", error);
        }
      }

      console.log("💧 Detected LP/Vault positions:", lpPositions.length);
      if (!cancelled) {
        setLiquidityPositions(lpPositions);
      }
    };

    detectLPPositions();
    return () => { cancelled = true; };
  }, [indexerBalances, viewingAddress, priceMap]);

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
        console.log("📅 Wallet age data:", ageData);
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
      console.log("Refreshing assets for:", viewingAddress);
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
                          src={userProfile?.pfp || '/pfp.PNG'} 
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



                {!defiLoading && positions.length === 0 && viewingAddress && (

                    <div className="empty-state">No active DeFi positions found</div>

                )}

               

                {!defiLoading && positions.length === 0 && !viewingAddress && (

                    <div className="empty-state">Connect wallet to view DeFi positions</div>

                )}



                {!defiLoading && positions.length > 0 && (() => {
                    // Group positions by protocol
                    const groupedByProtocol = positions.reduce((acc, pos) => {
                      const key = pos.protocolName || 'Unknown';
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(pos);
                      return acc;
                    }, {});
                    
                    return Object.entries(groupedByProtocol).map(([protocolName, protocolPositions], index) => (
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
              
              {/* Profile Picture */}
              <div className="modal-avatar-section">
                <img 
                  src={userProfile?.pfp || '/pfp.PNG'} 
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
                <button 
                  className="modal-edit-btn"
                  onClick={() => {
                    setShowProfileModal(false);
                    navigate('/profile');
                  }}
                >
                  Edit Profile
                </button>
              </div>

              {/* Badges Section */}
              <div className="modal-badges-section">
                <h3 className="modal-badges-title">Collected Badges</h3>
                <div className="modal-badges-grid">
                  {badges.filter(b => b.earned).map(badge => (
                    <div key={badge.id} className="modal-badge-item">
                      <span className="modal-badge-icon">{badge.icon}</span>
                      <span className="modal-badge-name">{badge.name}</span>
                    </div>
                  ))}
                </div>
                {badges.filter(b => b.earned).length === 0 && (
                  <p className="modal-no-badges">No badges earned yet</p>
                )}
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

  return (

    <ErrorBoundary>

      <AptosWalletAdapterProvider plugins={wallets} autoConnect={true}>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/*" element={
            <Layout>
              <Routes>
                <Route path="/wallet/:address" element={<Dashboard />} />
                <Route path="/swap" element={<SwapPageWrapper />} />
                <Route path="/badges" element={<Badges />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/profile/:address" element={<ProfileView />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/more" element={<More />} />
              </Routes>
            </Layout>
          } />
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
  const { balances } = useIndexerBalances(walletAddress);

  return <SwapPage balances={balances || []} />;
};



export default App;