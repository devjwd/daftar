import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import "./Dashboard.css";

import { DEFAULT_NETWORK } from "../config/network";
import { ANIMATION_DELAYS, FORMATTING, INTERVALS } from "../config/constants";
import { DEFAULT_PROTOCOL_VISUAL, DEFAULT_TOKEN_COLOR, DEFI_PROTOCOL_VISUALS, TOKEN_VISUALS } from "../config/display";
import { getTokenAddressBySymbol, getTokenInfo } from "../config/tokens";
import { useCurrency } from "../hooks/useCurrency";
import { useIndexerBalances, IndexerBalance } from "../hooks/useIndexerBalances";
import { useMovementClient } from "../hooks/useMovementClient";
import { useProfile } from "../hooks/useProfile";
import { useTokenPrices } from "../hooks/useTokenPrices";
import { useUserLevel } from "../hooks/useUserLevel";
import { useDeFiPositions } from "../hooks/useDeFiPositions";
import { useNFTs } from "../hooks/useNFTs";
import { getWalletAge, getUserNFTHoldings, getUserTokenBalances, getYuzuLiquidityPositions } from "../services/indexer";
import { getLevelBasedPfp } from "../utils/levelPfp";
import { getStoredLanguagePreference, t } from "../utils/language";
import { getSettingsStorageKey, getStoredHidePositionThreshold } from "../utils/settings";
import { useAddressLabel } from "../hooks/useAddressLabel";

import { devLog } from "../utils/devLogger";
import { getTokenDecimals, isValidAddress, parseCoinType } from "../utils/tokenUtils";
import { resolveTokenPrice } from "../utils/price";
import ProfileCard from "../components/ProfileCard";
import { ALL_ADAPTERS } from "../config/adapters/index";
import { resolveEntityBranding } from "../services/entityStore";

import PNLChart from "../components/Dashboard/PNLChart";
import ProfileModal from "../components/Dashboard/ProfileModal";
import PortfolioTabs, { PORTFOLIO_TABS } from "../components/Dashboard/PortfolioTabs";
import {
  NetWorthValueSkeleton,
  NetWorthMetaSkeleton,
} from "../components/Dashboard/Skeletons";
import {
  processBalances,
  getTokenPriceFromMap,
  getPrecisionDecimals
} from "../utils/dashboardUtils";

import OverviewTab from '../components/Dashboard/OverviewTab';
import TransactionsTab from '../components/Dashboard/TransactionsTab';
import NFTTab from '../components/Dashboard/NFTTab';
const AnalyticsView = lazy(() => import('../components/Analytics/AnalyticsView'));

// PORTFOLIO_TABS imported from PortfolioTabs component

const LP_DISCOVERY_CACHE_TTL_MS = 90 * 1000;

const shouldDisplayPosition = (usdValue: number | null | undefined, threshold: number) => {
  if (usdValue === null || usdValue === undefined) return true;
  if (!threshold || threshold <= 0) return true;
  return usdValue >= threshold;
};

const ErrorMessage = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
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
  const { address: urlAddress, "*": splat } = useParams();
  const activeTab = useMemo(() => {
    if (!splat) return PORTFOLIO_TABS.OVERVIEW;
    const segments = splat.split("/").filter(Boolean);
    if (segments.length === 0) return PORTFOLIO_TABS.OVERVIEW;
    return Object.values(PORTFOLIO_TABS).includes(segments[0]) ? segments[0] : PORTFOLIO_TABS.OVERVIEW;
  }, [splat]);

  const [language, setLanguage] = useState(() => getStoredLanguagePreference());
  const [error, setError] = useState<string | null>(null);
  const [viewingAddress, setViewingAddress] = useState<string | null>(null);

  useEffect(() => {
    if (urlAddress === 'null' || urlAddress === 'undefined') {
      navigate('/', { replace: true });
    }
  }, [urlAddress, navigate]);

  const [walletAge, setWalletAge] = useState<{ firstTxTimestamp?: string } | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [hidePositionThreshold, setHidePositionThreshold] = useState(0);
  const meridianPoolInfoCacheRef = useRef(new Map());
  const yuzuDiscoveryCacheRef = useRef(new Map());

  const getAddressString = (accountObj: { address?: string | { toString(): string; hex?(): string; data?: Uint8Array | number[] } } | null | undefined): string | null => {
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
    const str = addr ? String(addr).trim() : "";
    if (str && str !== "[object Object]" && str !== "null" && str !== "undefined") {
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

  // 1. Pricing and Basic Data
  const { prices: priceMap, priceChanges, loading: pricesLoading, error: pricesError, refresh: refreshPrices } = useTokenPrices();

  const {
    balances: indexerBalances,
    loading: indexerLoading,
    error: indexerError,
    refetch: refreshIndexer
  } = useIndexerBalances(viewingAddress);

  const { client, loading: clientLoading, error: clientError } = useMovementClient();

  // 2. Discovery Engine (Depends on priceMap)
  const {
    positions: allPositions,
    loading: defiLoading,
    refresh: refreshDeFi
  } = useDeFiPositions(viewingAddress, priceMap, indexerBalances);

  const movePrice = useMemo(() => getTokenPriceFromMap('MOVE', priceMap) || 0, [priceMap]);

  const [valuationMethod, setValuationMethod] = useState<'topBid' | 'floor'>('topBid');

  const {
    nfts: userNFTs,
    groupedCollections,
    totalWorth: nftsTotalWorth,
    totalWorthMove: nftsTotalWorthMove,
    loading: nftsLoading,
    refresh: refreshNFTs
  } = useNFTs(viewingAddress, movePrice, valuationMethod);

  const settingsKey = useMemo(() => getSettingsStorageKey(account?.address), [account?.address]);


  const [hideValues, setHideValues] = useState(() => localStorage.getItem('hideValues') === 'true');
  const [viewMode, setViewMode] = useState('grid');
  const [allDeFiExpanded, setAllDeFiExpanded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [showToast, setShowToast] = useState(false);

  const { convertUSD, formatValue: formatCurrencyValue, currencySymbol } = useCurrency();

  useEffect(() => {
    localStorage.setItem('hideValues', hideValues.toString());
  }, [hideValues]);

  useEffect(() => {
    const syncHidePositionThreshold = () => {
      setHidePositionThreshold(getStoredHidePositionThreshold(settingsKey));
    };

    syncHidePositionThreshold();

    const onStorage = (event: StorageEvent) => {
      if (!event?.key || event.key === 'settings_global' || event.key === settingsKey) {
        syncHidePositionThreshold();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [settingsKey]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      // 1. Refresh prices and base balances first
      const [priceData, balanceData] = await Promise.all([
        refreshPrices(),
        refreshIndexer()
      ]);

      // 2. Then refresh DeFi positions and NFTs
      await Promise.all([
        refreshDeFi({
          force: true,
          priceMap: priceData?.prices,
          balances: balanceData
        }),
        refreshNFTs()
      ]);

      // 3. Update lastRefresh to trigger TrxHistory and other sub-components
      setLastRefresh(Date.now());

      devLog("Dashboard: Full data refresh complete");
    } catch (err) {
      console.error("Refresh failed:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshPrices, refreshIndexer, refreshDeFi, isRefreshing]);

  // 3. Derived States (Calculated from Discovery results)
  const visibleLiquidityPositions = useMemo(() =>
    allPositions.filter(p => p.type === "Liquidity"),
    [allPositions]
  );

  const visibleStakingPositions = useMemo(() =>
    allPositions.filter(p => p.type === "Staking"),
    [allPositions]
  );

  const visibleDeFiPositions = useMemo(() =>
    allPositions.filter(p => p.type !== "Liquidity" && p.type !== "Staking" && p.type !== "Asset"),
    [allPositions]
  );

  const balances = useMemo(() =>
    processBalances(indexerBalances, priceMap, allPositions),
    [indexerBalances, priceMap, allPositions]);

  const totalUsdValue = useMemo(() =>
    balances.reduce((sum, b) => sum + (b.usdValue || 0), 0),
    [balances]
  );

  const defiNetValue = useMemo(() => {
    return visibleDeFiPositions.reduce((sum, p) => {
      const v = p.numericValue || 0;
      return sum + (p.type === "Debt" ? -v : v);
    }, 0);
  }, [visibleDeFiPositions]);

  const liquidityTotalValue = useMemo(() => {
    return visibleLiquidityPositions.reduce((sum, p) => sum + (p.numericValue || 0), 0);
  }, [visibleLiquidityPositions]);

  const stakingTotalValue = useMemo(() => {
    return visibleStakingPositions.reduce((sum, p) => sum + (p.numericValue || 0), 0);
  }, [visibleStakingPositions]);

  const combinedNetWorth = totalUsdValue + defiNetValue + liquidityTotalValue + stakingTotalValue + (nftsTotalWorth || 0);
  const assetsLoading = pricesLoading || indexerLoading || clientLoading || nftsLoading;
  const lpLoading = defiLoading;

  const { profile: userProfile } = useProfile(viewingAddress);
  const { level: viewingLevel } = useUserLevel(viewingAddress);
  const { label: addressLabel } = useAddressLabel(viewingAddress);

  const entityBranding = useMemo(() => resolveEntityBranding(viewingAddress), [viewingAddress]);

  const userAvatarSrc = entityBranding?.logo || getLevelBasedPfp({
    level: viewingLevel,
    address: viewingAddress,
    preferredPfp: userProfile?.avatar_url,
  });


  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getStoredLanguagePreference());
    };

    const onLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent)?.detail?.language;
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



  // Actual Breakdown Data Calculations
  // Actual Breakdown Data Calculations
  const assetBreakdownData = useMemo(() => {
    const total = combinedNetWorth;
    if (total <= 0) return [];
    
    const data = [
      { name: 'Wallet', value: Math.round((totalUsdValue / total) * 100), color: '#cda169', rawValue: totalUsdValue },
      { name: 'DeFi', value: Math.round((defiNetValue / total) * 100), color: '#b2854f', rawValue: defiNetValue },
      { name: 'LP', value: Math.round((liquidityTotalValue / total) * 100), color: '#e5be8a', rawValue: liquidityTotalValue },
      { name: 'Staking', value: Math.round((stakingTotalValue / total) * 100), color: '#deb884', rawValue: stakingTotalValue },
      { name: 'NFTs', value: Math.round(((nftsTotalWorth || 0) / total) * 100), color: '#895f2d', rawValue: nftsTotalWorth || 0 },
    ].filter(d => d.rawValue > 0);
    
    // Normalize to 100%
    const sum = data.reduce((acc, curr) => acc + curr.value, 0);
    if (sum !== 100 && data.length > 0) {
      data[0].value += (100 - sum);
    }
    return data;
  }, [totalUsdValue, defiNetValue, liquidityTotalValue, stakingTotalValue, nftsTotalWorth, combinedNetWorth]);

  const protocolBreakdownData = useMemo(() => {
    const protocolMap = new Map();
    protocolMap.set('Holding', totalUsdValue + (nftsTotalWorth || 0));
    
    [...visibleDeFiPositions, ...visibleLiquidityPositions, ...visibleStakingPositions].forEach(p => {
       const proto = p.protocolName || p.platform || 'Unknown';
       protocolMap.set(proto, (protocolMap.get(proto) || 0) + (p.numericValue || 0));
     });
    
    const total = combinedNetWorth;
    if (total <= 0) return [];

    const colors = [
      '#cda169', // Main Brand Gold
      '#b2854f', // Deep Bronze
      '#e5be8a', // Warm Amber
      '#895f2d', // Copper Brown
      '#f4d9b1', // Champagne
      '#6b5233', // Deep Chocolate Earth
      '#9ca3af'  // Neutral Slate
    ];
    
    const sorted = Array.from(protocolMap.entries())
      .map(([name, value]) => ({ 
         name, 
         rawValue: value, 
         value: Math.round((value / total) * 100)
      }))
      .filter(d => d.rawValue > 0)
      .sort((a, b) => b.rawValue - a.rawValue)
      .map((item, idx) => ({
         ...item,
         color: colors[idx % colors.length]
      }));
      
    let finalData = sorted;
    if (sorted.length > 5) {
      finalData = sorted.slice(0, 4);
      const others = sorted.slice(4);
      const othersValue = others.reduce((acc, curr) => acc + curr.rawValue, 0);
      const othersPct = others.reduce((acc, curr) => acc + curr.value, 0);
      finalData.push({ name: 'Others', rawValue: othersValue, value: othersPct, color: '#9ca3af' });
    }
    
    const sum = finalData.reduce((acc, curr) => acc + curr.value, 0);
    if (sum !== 100 && finalData.length > 0) {
      finalData[0].value += (100 - sum);
    }
    
    return finalData;
  }, [totalUsdValue, nftsTotalWorth, visibleDeFiPositions, visibleLiquidityPositions, visibleStakingPositions, combinedNetWorth]);

  useEffect(() => {
    if (account && connected) {
      const addressString = getAddressString(account);
      if (addressString) {
        if (!urlAddress && isValidAddress(addressString)) {
          setViewingAddress(addressString);
          navigate(`/profile/${addressString}`, { replace: true });
        }
      } else {
        console.error("Could not extract wallet address. Please try reconnecting.");
      }
    } else if (!connected) {
      if (!urlAddress) {
        setViewingAddress(null);
        navigate('/', { replace: true });
      }
    }
  }, [account, connected, navigate, urlAddress]);
  useEffect(() => {
    if (viewingAddress && (!account || viewingAddress !== getAddressString(account))) {
      devLog("Viewing searched address:", viewingAddress, "(indexer will fetch)");
    }
  }, [viewingAddress, account]);




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

  useEffect(() => {
    if (!viewingAddress) return;

    const name = userProfile?.username || (
      viewingAddress.startsWith("0x") 
        ? `${viewingAddress.slice(0, 6)}...${viewingAddress.slice(-4)}` 
        : viewingAddress
    );

    let tabLabel = "";
    if (activeTab === PORTFOLIO_TABS.TRX) tabLabel = " - Transactions";
    else if (activeTab === PORTFOLIO_TABS.NFT) tabLabel = " - NFTs";
    else if (activeTab === PORTFOLIO_TABS.ANALYTICS) {
      tabLabel = " - Analytics";
    }

    document.title = `${name}${tabLabel} | Daftar`;

    // Update SEO Meta Tags
    const metaDesc = `View ${name}'s portfolio on the Movement Network. Real-time net worth, transaction history, NFTs, and portfolio analytics.`;
    
    const updateMeta = (name: string, content: string, attr = 'name') => {
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    updateMeta('description', metaDesc);
    updateMeta('og:title', `${name}${tabLabel} | Daftar`, 'property');
    updateMeta('og:description', metaDesc, 'property');
    updateMeta('twitter:title', `${name}${tabLabel} | Daftar`);
    updateMeta('twitter:description', metaDesc);

    // Update Canonical URL
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', window.location.href);
  }, [userProfile, viewingAddress, activeTab, splat]);

  const formatWalletAge = (ageData: { firstTxTimestamp?: string } | null): string | null => {
    if (!ageData?.firstTxTimestamp) return null;

    const firstDate = new Date(ageData.firstTxTimestamp);
    const now = new Date();
    const diffMs = now.getTime() - firstDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 1) return "< 1";
    return diffDays.toString();
  };




  // eslint-disable-next-line no-unused-vars
  const handleViewExplorer = (token: { address?: string }) => {
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
                    onClick={() => setHideValues(prev => !prev)}
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
                      <span className="verified-tick" title="Verified Profile">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
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
            isVerified={userProfile?.is_verified}
            balances={balances}
            priceChanges={priceChanges}
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

      <PortfolioTabs
        activeTab={activeTab}
        urlAddress={urlAddress}
        canEditProfile={canEditProfile}
        language={language}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="portfolio-content-panel"
        >
          {activeTab === PORTFOLIO_TABS.OVERVIEW && (
            <OverviewTab
              language={language}
              hideValues={hideValues}
              viewMode={viewMode}
              setViewMode={setViewMode}
              allDeFiExpanded={allDeFiExpanded}
              setAllDeFiExpanded={setAllDeFiExpanded}
              balances={balances}
              indexerLoading={indexerLoading}
              defiLoading={defiLoading}
              assetsLoading={assetsLoading}
              lpLoading={lpLoading}
              indexerError={indexerError}
              error={error}
              viewingAddress={viewingAddress}
              totalUsdValue={totalUsdValue}
              defiNetValue={defiNetValue}
              liquidityTotalValue={liquidityTotalValue}
              stakingTotalValue={stakingTotalValue}
              visibleDeFiPositions={visibleDeFiPositions}
              visibleLiquidityPositions={visibleLiquidityPositions}
              visibleStakingPositions={visibleStakingPositions}
              priceMap={priceMap}
              convertUSD={convertUSD}
              formatCurrencyValue={formatCurrencyValue}
              currencySymbol={currencySymbol}
            />
          )}

          {activeTab === PORTFOLIO_TABS.TRX && (
            <TransactionsTab
              viewingAddress={viewingAddress}
              lastRefresh={lastRefresh}
              isVerified={userProfile?.is_verified}
              hideValues={hideValues}
              language={language}
            />
          )}

          {activeTab === PORTFOLIO_TABS.NFT && (
            <NFTTab
              userNFTs={userNFTs}
              groupedCollections={groupedCollections}
              nftsLoading={nftsLoading}
              viewingAddress={viewingAddress}
              hideValues={hideValues}
              convertUSD={convertUSD}
              formatCurrencyValue={formatCurrencyValue}
              movePrice={movePrice}
              valuationMethod={valuationMethod}
              setValuationMethod={setValuationMethod}
              totalWorthMove={nftsTotalWorthMove || 0}
              totalWorthUSD={nftsTotalWorth || 0}
            />
          )}

          {activeTab === PORTFOLIO_TABS.ANALYTICS && (
            <Suspense fallback={<div className="loading-indicator">Analyzing history...</div>}>
              <AnalyticsView 
                walletAddress={urlAddress} 
              />
            </Suspense>
          )}
        </motion.div>
      </AnimatePresence>

      {showProfileModal && (
        <ProfileModal
          viewingAddress={viewingAddress}
          canEditProfile={canEditProfile}
          language={language}
          onClose={() => setShowProfileModal(false)}
        />
      )}

    </>

  );

};

export default Dashboard;
