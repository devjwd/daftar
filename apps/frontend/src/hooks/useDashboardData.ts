import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import { useTokenPrices } from "./useTokenPrices";
import { useIndexerBalances } from "./useIndexerBalances";
import { useMovementClient } from "./useMovementClient";
import { useDeFiPositions } from "./useDeFiPositions";
import { useProfile } from "./useProfile";
import { useAddressLabel } from "./useAddressLabel";
import { useCurrency } from "./useCurrency";

import { PORTFOLIO_TABS } from "../components/Dashboard/PortfolioTabs";
import { resolveEntityBranding } from "../services/entityStore";
import { getWalletAge } from "../services/indexer";
import { getStoredLanguagePreference, t } from "../utils/language";
import { getSettingsStorageKey, getStoredHidePositionThreshold } from "../utils/settings";
import { devLog } from "../utils/devLogger";
import { isValidAddress } from "../utils/tokenUtils";
import { getTokenPriceFromMap, processBalances } from "../utils/dashboardUtils";

const getAddressString = (accountObj: any): string | null => {
  if (!accountObj || !accountObj.address) return null;
  const addr = accountObj.address;
  if (typeof addr === "string") return addr.trim();
  if (addr && typeof addr === "object") {
    try {
      if (typeof addr.toString === "function" && addr.toString !== Object.prototype.toString) {
        const str = addr.toString();
        if (str && str.startsWith("0x")) return str;
      }
      if (typeof addr.hex === "function") return addr.hex();
      if (addr.data) {
        let dataArray = addr.data instanceof Uint8Array ? Array.from(addr.data) : Array.isArray(addr.data) ? addr.data : [];
        if (dataArray.length > 0) {
          const hex = dataArray.map((b: any) => (typeof b === "number" ? b : parseInt(b, 10)).toString(16).padStart(2, "0")).join("");
          return `0x${hex}`;
        }
      }
    } catch (e) {
      console.warn("Error converting address object:", e);
    }
  }
  const str = addr ? String(addr).trim() : "";
  if (str && str !== "[object Object]" && str !== "null" && str !== "undefined") return str;
  return null;
};

export const useDashboardData = () => {
  const { account, connected } = useWallet();
  const navigate = useNavigate();
  const location = useLocation();
  const { address: urlAddress, "*": splat } = useParams();

  const activeTab = useMemo(() => {
    if (!splat) return PORTFOLIO_TABS.OVERVIEW;
    const segments = splat.split("/").filter(Boolean);
    if (segments.length === 0) return PORTFOLIO_TABS.OVERVIEW;
    return Object.values(PORTFOLIO_TABS).includes(segments[0] as any) ? segments[0] : PORTFOLIO_TABS.OVERVIEW;
  }, [splat]);

  const [language, setLanguage] = useState(() => getStoredLanguagePreference());
  const [error, setError] = useState<string | null>(null);
  const [viewingAddress, setViewingAddress] = useState<string | null>(null);
  const [walletAge, setWalletAge] = useState<{ firstTxTimestamp?: string } | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [hidePositionThreshold, setHidePositionThreshold] = useState(0);

  const connectedWalletAddress = connected ? getAddressString(account) : null;
  const canEditProfile = Boolean(
    connectedWalletAddress && viewingAddress && connectedWalletAddress.toLowerCase() === viewingAddress.toLowerCase()
  );

  const { prices: priceMap, priceChanges, loading: pricesLoading, error: pricesError, refresh: refreshPrices } = useTokenPrices();
  const { balances: indexerBalances, loading: indexerLoading, error: indexerError, refetch: refreshIndexer } = useIndexerBalances(viewingAddress);
  const { client, loading: clientLoading, error: clientError } = useMovementClient();

  const { positions: allPositions, loading: defiLoading, refresh: refreshDeFi } = useDeFiPositions(viewingAddress, priceMap, indexerBalances);

  const settingsKey = useMemo(() => getSettingsStorageKey(account?.address), [account?.address]);
  const [hideValues, setHideValues] = useState(() => localStorage.getItem('hideValues') === 'true');
  const [viewMode, setViewMode] = useState('grid');
  const [allDeFiExpanded, setAllDeFiExpanded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [showToast, setShowToast] = useState(false);

  const { convertUSD, formatValue: formatCurrencyValue, currencySymbol } = useCurrency();

  useEffect(() => { localStorage.setItem('hideValues', hideValues.toString()); }, [hideValues]);

  useEffect(() => {
    const syncHidePositionThreshold = () => setHidePositionThreshold(getStoredHidePositionThreshold(settingsKey));
    syncHidePositionThreshold();
    const onStorage = (event: StorageEvent) => {
      if (!event?.key || event.key === 'settings_global' || event.key === settingsKey) syncHidePositionThreshold();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [settingsKey]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const [priceData, balanceData] = await Promise.all([refreshPrices(), refreshIndexer()]);
      await refreshDeFi({ force: true, priceMap: priceData?.prices, balances: balanceData });
      setLastRefresh(Date.now());
      devLog("Dashboard: Full data refresh complete");
    } catch (err) {
      console.error("Refresh failed:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshPrices, refreshIndexer, refreshDeFi, isRefreshing]);

  const visibleLiquidityPositions = useMemo(() => allPositions.filter(p => p.type === "Liquidity"), [allPositions]);
  const visibleStakingPositions = useMemo(() => allPositions.filter(p => p.type === "Staking"), [allPositions]);
  const visibleDeFiPositions = useMemo(() => allPositions.filter(p => p.type !== "Liquidity" && p.type !== "Staking" && p.type !== "Asset"), [allPositions]);

  const balances = useMemo(() => processBalances(indexerBalances, priceMap, allPositions), [indexerBalances, priceMap, allPositions]);
  const totalUsdValue = useMemo(() => balances.reduce((sum, b) => sum + (b.usdValue || 0), 0), [balances]);

  const defiNetValue = useMemo(() => visibleDeFiPositions.reduce((sum, p) => sum + (p.type === "Debt" ? -(p.numericValue || 0) : (p.numericValue || 0)), 0), [visibleDeFiPositions]);
  const liquidityTotalValue = useMemo(() => visibleLiquidityPositions.reduce((sum, p) => sum + (p.numericValue || 0), 0), [visibleLiquidityPositions]);
  const stakingTotalValue = useMemo(() => visibleStakingPositions.reduce((sum, p) => sum + (p.numericValue || 0), 0), [visibleStakingPositions]);

  const combinedNetWorth = totalUsdValue + defiNetValue + liquidityTotalValue + stakingTotalValue;
  const assetsLoading = pricesLoading || indexerLoading || clientLoading;
  const lpLoading = defiLoading;

  const { profile: userProfile } = useProfile(viewingAddress);
  const { label: addressLabel } = useAddressLabel(viewingAddress);
  const entityBranding = useMemo(() => resolveEntityBranding(viewingAddress), [viewingAddress]);
  const userAvatarSrc = entityBranding?.logo || userProfile?.avatar_url || '/pfp/default.png';

  useEffect(() => {
    const syncLanguage = () => setLanguage(getStoredLanguagePreference());
    const onLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent)?.detail?.language;
      if (nextLanguage) setLanguage(nextLanguage);
      else syncLanguage();
    };
    window.addEventListener('languagechange', onLanguageChange);
    window.addEventListener('storage', syncLanguage);
    return () => {
      window.removeEventListener('languagechange', onLanguageChange);
      window.removeEventListener('storage', syncLanguage);
    };
  }, []);

  useEffect(() => {
    if (urlAddress && isValidAddress(urlAddress)) setViewingAddress(urlAddress);
    else if (!urlAddress && !connected) setViewingAddress(null);
  }, [urlAddress, connected]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const addressParam = params.get('address');
    if (addressParam && isValidAddress(addressParam)) navigate(`/profile/${addressParam}`, { replace: true });
  }, [location.search, navigate]);

  const assetBreakdownData = useMemo(() => {
    const total = combinedNetWorth;
    if (total <= 0) return [];
    const data = [
      { name: 'Wallet', value: Math.round((totalUsdValue / total) * 100), color: '#cda169', rawValue: totalUsdValue },
      { name: 'DeFi', value: Math.round((defiNetValue / total) * 100), color: '#b2854f', rawValue: defiNetValue },
      { name: 'LP', value: Math.round((liquidityTotalValue / total) * 100), color: '#e5be8a', rawValue: liquidityTotalValue },
      { name: 'Staking', value: Math.round((stakingTotalValue / total) * 100), color: '#deb884', rawValue: stakingTotalValue },
    ].filter(d => d.rawValue > 0);
    const sum = data.reduce((acc, curr) => acc + curr.value, 0);
    if (sum !== 100 && data.length > 0) data[0].value += (100 - sum);
    return data;
  }, [totalUsdValue, defiNetValue, liquidityTotalValue, stakingTotalValue, combinedNetWorth]);

  const protocolBreakdownData = useMemo(() => {
    const protocolMap = new Map();
    protocolMap.set('Holding', totalUsdValue);
    [...visibleDeFiPositions, ...visibleLiquidityPositions, ...visibleStakingPositions].forEach(p => {
      const proto = p.protocolName || p.platform || 'Unknown';
      protocolMap.set(proto, (protocolMap.get(proto) || 0) + (p.numericValue || 0));
    });
    const total = combinedNetWorth;
    if (total <= 0) return [];
    const colors = ['#cda169', '#b2854f', '#e5be8a', '#895f2d', '#f4d9b1', '#6b5233', '#9ca3af'];
    const sorted = Array.from(protocolMap.entries())
      .map(([name, value]) => ({ name, rawValue: value, value: Math.round((value / total) * 100) }))
      .filter(d => d.rawValue > 0)
      .sort((a, b) => b.rawValue - a.rawValue)
      .map((item, idx) => ({ ...item, color: colors[idx % colors.length] }));
    let finalData = sorted;
    if (sorted.length > 5) {
      finalData = sorted.slice(0, 4);
      const others = sorted.slice(4);
      finalData.push({ 
        name: 'Others', 
        rawValue: others.reduce((acc, curr) => acc + curr.rawValue, 0), 
        value: others.reduce((acc, curr) => acc + curr.value, 0), 
        color: '#9ca3af' 
      });
    }
    const sum = finalData.reduce((acc, curr) => acc + curr.value, 0);
    if (sum !== 100 && finalData.length > 0) finalData[0].value += (100 - sum);
    return finalData;
  }, [totalUsdValue, visibleDeFiPositions, visibleLiquidityPositions, visibleStakingPositions, combinedNetWorth]);

  useEffect(() => {
    if (account && connected) {
      const addressString = getAddressString(account);
      if (addressString) {
        if (!urlAddress && isValidAddress(addressString)) {
          setViewingAddress(addressString);
          navigate(`/profile/${addressString}`, { replace: true });
        }
      }
    } else if (!connected) {
      if (!urlAddress) {
        setViewingAddress(null);
        navigate('/', { replace: true });
      }
    }
  }, [account, connected, navigate, urlAddress]);

  useEffect(() => {
    const fetchWalletData = async () => {
      if (!viewingAddress) { setWalletAge(null); return; }
      try { setWalletAge(await getWalletAge(viewingAddress)); } catch (err) {}
    };
    fetchWalletData();
  }, [viewingAddress]);

  useEffect(() => {
    if (!viewingAddress) return;
    const name = userProfile?.username || (viewingAddress.startsWith("0x") ? `${viewingAddress.slice(0, 6)}...${viewingAddress.slice(-4)}` : viewingAddress);
    let tabLabel = "";
    if (activeTab === PORTFOLIO_TABS.TRX) tabLabel = " - Transactions";
    else if (activeTab === PORTFOLIO_TABS.ANALYTICS) tabLabel = " - Analytics";
    document.title = `${name}${tabLabel} | Daftar`;
  }, [userProfile, viewingAddress, activeTab, splat]);

  useEffect(() => {
    if (!assetsLoading && viewingAddress && userProfile) {
      const API_URL = (import.meta as any).env?.VITE_API_URL || '';
      fetch(`${API_URL}/api/analytics/trigger-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: viewingAddress })
      }).catch(() => {});
    }
  }, [assetsLoading, viewingAddress, userProfile]);

  return {
    urlAddress,
    activeTab,
    language,
    error,
    viewingAddress,
    walletAge,
    showProfileModal,
    setShowProfileModal,
    hidePositionThreshold,
    canEditProfile,
    priceMap,
    priceChanges,
    indexerBalances,
    indexerLoading,
    defiLoading,
    assetsLoading,
    lpLoading,
    indexerError,
    hideValues,
    setHideValues,
    viewMode,
    setViewMode,
    allDeFiExpanded,
    setAllDeFiExpanded,
    isRefreshing,
    lastRefresh,
    showToast,
    setShowToast,
    convertUSD,
    formatCurrencyValue,
    currencySymbol,
    handleRefresh,
    visibleLiquidityPositions,
    visibleStakingPositions,
    visibleDeFiPositions,
    balances,
    totalUsdValue,
    defiNetValue,
    liquidityTotalValue,
    stakingTotalValue,
    combinedNetWorth,
    userProfile,
    addressLabel,
    entityBranding,
    userAvatarSrc,
    assetBreakdownData,
    protocolBreakdownData
  };
};
