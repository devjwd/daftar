import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useUserLevel } from '../hooks/useUserLevel';
import { formatAddress, isValidAddress } from '../utils/tokenUtils';
import { getStoredLanguagePreference, t } from '../utils/language';
import { getStoredThemePreference, resolveTheme } from '../utils/theme';
import {
  resolveAddressOrUsernameAsync,
  searchProfilesAsync,
  getProfileAsync,
  resolveAddressOrUsername,
  searchProfiles,
  getProfile,
} from '../services/profileService';
import { checkAccountExists } from '../services/indexer';
import { getEnv } from '../config/envValidator';
import { searchEntities } from '../services/entityStore';
import { getTransactionByHash } from '../services/transactionService';
import TransactionVisualizer from './Transactions/TransactionVisualizer';
import './Layout.css';
import { FeedbackModal } from './FeedbackModal';
import { BugReportModal } from './BugReportModal';
import { WalletModal } from './WalletModal';
import { useIndexerBalances } from '../hooks/useIndexerBalances';
import { useTokenPrices } from '../hooks/useTokenPrices';
import { useCurrency } from '../hooks/useCurrency';

const SWAP_ENABLED = getEnv('VITE_ENABLE_SWAP', true);
const RESOURCES_MANIFEST_URL = '/resources/manifest.json';

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { connect, disconnect, account, connected, wallets, wallet } = useWallet();

  const getWalletLogo = (name) => {
    if (!name) return null;
    const lowerName = name.toLowerCase();
    if (lowerName.includes('okx')) return '/okx.png';
    if (lowerName.includes('leap')) return '/leap.png';
    if (lowerName.includes('razor')) return '/razor.png';
    if (lowerName.includes('nightly')) return '/nightly.png';
    if (lowerName.includes('petra')) return '/logo.png';
    if (lowerName.includes('motion')) return '/motion.png';
    return null;
  };

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugReportParams, setBugReportParams] = useState<{
    type: string;
    symbol: string;
    address: string;
    description?: string;
  }>({ type: 'general', symbol: '', address: '', description: '' });

  useEffect(() => {
    const handleOpenBugReport = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setBugReportParams({
        type: detail.type || 'general',
        symbol: detail.symbol || '',
        address: detail.address || '',
        description: detail.description || ''
      });
      setBugReportOpen(true);
    };

    window.addEventListener('open-bug-report', handleOpenBugReport);
    return () => window.removeEventListener('open-bug-report', handleOpenBugReport);
  }, []);

  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [moreDropdownOpen, setMoreDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selectedTxForPlayback, setSelectedTxForPlayback] = useState<any | null>(null);
  const [recentSearches, setRecentSearches] = useState(() => {
    const saved = localStorage.getItem('recentSearches');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  });
  const [activeTheme, setActiveTheme] = useState(() => resolveTheme(getStoredThemePreference()));
  const [language, setLanguage] = useState(() => getStoredLanguagePreference());
  const searchTimeoutRef = useRef(null);
  const latestQueryRef = useRef("");
  const blurTimeoutRef = useRef(null);


  const passAddress = account?.address ? String(account.address) : null;
  const { level: passLevel, loading: passLevelLoading } = useUserLevel(passAddress);

  const { balances } = useIndexerBalances(passAddress);
  const { prices } = useTokenPrices();
  const { convertUSD, formatValue } = useCurrency();

  const netWorth = useMemo(() => {
    if (!passAddress || !balances || balances.length === 0) return 0;
    return balances.reduce((total, token) => {
      const price = prices[token.address] || prices[token.fullType] || 0;
      return total + (token.numericAmount * price);
    }, 0);
  }, [passAddress, balances, prices]);

  const formattedNetWorth = useMemo(() => {
    const converted = convertUSD(netWorth);
    return formatValue(converted);
  }, [netWorth, convertUSD, formatValue]);

  // Monitor wallet connections and switches
  const [wasConnected, setWasConnected] = useState(connected);
  const lastConnectedRef = useRef(account?.address ? String(account.address) : null);

  useEffect(() => {
    const currentAddress = account?.address ? String(account.address) : null;
    const lastConnectedAddress = lastConnectedRef.current;

    if (connected && currentAddress) {
      const isViewingProfile = location.pathname.startsWith('/profile/');
      const justConnected = !wasConnected;
      const addressChanged = lastConnectedAddress !== null && lastConnectedAddress !== currentAddress;

      if (justConnected || addressChanged) {
        if (isViewingProfile || addressChanged) {
          navigate(`/profile/${currentAddress}`);
        }
      }

      lastConnectedRef.current = currentAddress;
    } else if (wasConnected && !connected) {
      // User just disconnected their wallet
      navigate('/');
    }

    setWasConnected(connected);
  }, [connected, account?.address, location.pathname, navigate, wasConnected]);

  const isValidAvatarUrl = (url) => {
    if (!url) return false;
    const normalized = String(url).trim().toLowerCase();
    return normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('/');
  };

  const currentLogo = '/logo.png';

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const syncTheme = () => {
      setActiveTheme(resolveTheme(getStoredThemePreference()));
    };

    const onThemeChange = (event) => {
      const resolvedTheme = event?.detail?.resolvedTheme;
      if (resolvedTheme) {
        setActiveTheme(resolvedTheme);
      } else {
        syncTheme();
      }
    };

    window.addEventListener('themechange', onThemeChange);
    window.addEventListener('storage', syncTheme);
    return () => {
      window.removeEventListener('themechange', onThemeChange);
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

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

  // Save search to recent searches
  const saveRecentSearch = useCallback((address, name) => {
    if (!address || !isValidAddress(address)) return;

    setRecentSearches((prev) => {
      // name might be 'Wallet address' or a real username
      let displayName = name && name !== 'Wallet address' && name !== 'User' ? name : formatAddress(address, 8, 6);

      // Prevent saving very short or meaningless names as recent searches
      if (!displayName || displayName.length < 2) {
        displayName = formatAddress(address, 8, 6);
      }

      // Remove if already exists (by address)
      const filtered = prev.filter(item => {
        const itemAddr = typeof item === 'string' ? item : item.address;
        return itemAddr.toLowerCase() !== address.toLowerCase();
      });

      // Add to front
      const newItem = { address, name: displayName };
      const updated = [newItem, ...filtered].slice(0, 5);
      localStorage.setItem('recentSearches', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleClearRecentSearches = useCallback((e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setRecentSearches([]);
    localStorage.removeItem('recentSearches');
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (walletDropdownOpen && !event.target.closest('.wallet-dropdown-container')) {
        setWalletDropdownOpen(false);
      }
      if (moreDropdownOpen && !event.target.closest('.more-dropdown-container')) {
        setMoreDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [walletDropdownOpen, moreDropdownOpen]);

  const handleMoreClick = useCallback(() => {
    setMoreDropdownOpen(prev => !prev);
  }, []);

  const handleWalletClick = useCallback(() => {
    setWalletDropdownOpen(prev => !prev);
  }, []);

  const handleConnect = () => {
    setWalletPickerOpen(prev => !prev);
  };

  const handleResourcesDownload = useCallback(async () => {
    try {
      const response = await fetch(RESOURCES_MANIFEST_URL, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Resource manifest not found');
      }

      const data = await response.json();
      const files = Array.isArray(data?.files) ? data.files : [];

      for (const fileName of files) {
        if (typeof fileName !== 'string' || !fileName.trim()) {
          continue;
        }

        const downloadLink = document.createElement('a');
        downloadLink.href = encodeURI(`/resources/${fileName}`);
        downloadLink.download = fileName.split('/').pop() || 'resource';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
    } catch {
      window.open('/resources', '_blank', 'noopener,noreferrer');
    } finally {
      setMoreDropdownOpen(false);
    }
  }, []);

  const handleSelectWallet = async (walletName) => {
    try {
      await connect(walletName);
      setWalletPickerOpen(false);
    } catch (err) {
      console.error("Wallet connect failed", err);
    }
  };

  // Navigate to a profile address
  const goToWallet = useCallback(async (address, name, type?: string) => {
    if (!address) return;
    const addr = address.trim();
    saveRecentSearch(addr, name);
    navigate(`/profile/${addr}`);
    setSearchQuery("");
    setShowSuggestions(false);
    setSearchResults([]);
    setSearchError(null);
  }, [navigate, saveRecentSearch]);

  const buildLocalSearchResults = useCallback(async (query, signal?: AbortSignal) => {
    const remoteProfiles = await searchProfilesAsync(query, signal);
    const profiles = Array.isArray(remoteProfiles) && remoteProfiles.length > 0
      ? remoteProfiles
      : searchProfiles(query);

    const profileMatches = profiles
      .slice(0, 5)
      .map((profile) => ({
        type: 'profile',
        address: profile.address,
        username: profile.username || formatAddress(profile.address, 8, 6),
        pfp: profile.pfp || null,
      }));

    // Search for entities
    const entityMatches = searchEntities(query).map(entity => ({
      type: 'platform',
      address: entity.address,
      username: entity.name,
      pfp: entity.logo_url || '/movement-logo.svg',
      category: entity.category || 'Platform'
    }));

    // Combine results, prioritizing entities, up to a maximum of 5 matches
    const combinedResults = [...entityMatches, ...profileMatches].slice(0, 5);

    if (isValidAddress(query)) {
      const alreadyInResults = combinedResults.some(
        (p) => p.address?.toLowerCase() === query.toLowerCase()
      );

      const immediateResults = [...combinedResults];
      if (!alreadyInResults) {
        immediateResults.unshift({
          type: 'address',
          address: query,
          username: 'Wallet address',
          verified: false,
        });
      }

      return {
        isAddress: true,
        profileMatches: combinedResults,
        alreadyInResults,
        results: immediateResults.slice(0, 5),
      };
    }

    const resolved = await resolveAddressOrUsernameAsync(query, signal) || resolveAddressOrUsername(query);
    if (resolved && !profileMatches.some((p) => p.address?.toLowerCase() === resolved.toLowerCase())) {
      const existingProfile = await getProfileAsync(resolved) || getProfile(resolved);
      profileMatches.unshift({
        type: 'profile',
        address: resolved,
        username: existingProfile?.username || query,
        pfp: existingProfile?.pfp || null,
      });
    }

    return {
      isAddress: false,
      profileMatches: combinedResults,
      alreadyInResults: false,
      results: combinedResults,
    };
  }, []);

  // Debounced search effect
  useEffect(() => {
    const query = searchQuery.trim();
    latestQueryRef.current = query;

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    searchTimeoutRef.current = setTimeout(async () => {
      let localResults = [];
      try {
        const local = await buildLocalSearchResults(query, signal);
        if (latestQueryRef.current !== query || signal.aborted) {
          return;
        }
        localResults = local.results;

        if (!local.isAddress) {
          setSearchResults(localResults);
          setSearchLoading(false);
          setActiveSuggestionIndex(-1);
          return;
        }

        setSearchLoading(true);
        const { exists, txCount } = await checkAccountExists(query, signal);
        if (latestQueryRef.current !== query || signal.aborted) {
          return;
        }

        const results = [...local.profileMatches];
        if (!local.alreadyInResults) {
          results.unshift({
            type: exists ? 'blockchain' : 'address',
            address: query,
            username: exists ? `${txCount} transaction${txCount !== 1 ? 's' : ''}` : 'Wallet address',
            verified: exists,
          });
        }
        setSearchResults(results.slice(0, 5));
        setSearchLoading(false);
        setActiveSuggestionIndex(-1);
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn("Blockchain/profile lookup error:", err);
        if (latestQueryRef.current === query && !signal.aborted) {
          setSearchResults(localResults);
          setSearchLoading(false);
          setActiveSuggestionIndex(-1);
        }
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      controller.abort();
    };
  }, [searchQuery, buildLocalSearchResults]);

  // Search on Enter or button click
  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;

    // If valid address, navigate directly
    if (isValidAddress(query)) {
      goToWallet(query, 'Wallet address');
      return;
    }

    // Try to resolve username
    const resolvedAddress = await resolveAddressOrUsernameAsync(query) || resolveAddressOrUsername(query);
    if (resolvedAddress) {
      const profile = await getProfileAsync(resolvedAddress) || getProfile(resolvedAddress);
      goToWallet(resolvedAddress, profile?.username || query);
      return;
    }

    // If we have any search results, go to first
    if (searchResults.length > 0 && searchResults[0].address) {
      goToWallet(searchResults[0].address, searchResults[0].username, searchResults[0].type);
      return;
    }

    setSearchError("Enter a valid 0x address or username");
    setTimeout(() => setSearchError(null), 3000);
  }, [searchQuery, searchResults, goToWallet]);

  return (
    <div className="app-container">
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="navbar-inner">
          <div className="nav-left">
            <div className="logo-wrapper">
              <button className="logo-container logo-button" onClick={() => navigate("/")} type="button" aria-label="Go to home">
                <img src={currentLogo} alt="Movement logo" className="logo-img" />
              </button>
              <span className="logo-beta-tag">beta</span>
            </div>
            <ul className="nav-links">
              <li
                className={location.pathname.startsWith("/profile/") ? "active" : ""}
              >
                <button
                  type="button"
                  className="nav-link-btn"
                  onClick={() => {
                    const addr = account?.address ? String(account.address) : null;
                    if (connected && addr && addr !== "null" && addr !== "undefined") {
                      navigate(`/profile/${addr}`);
                    } else {
                      navigate("/");
                    }
                  }}
                >
                  {t(language, 'navPortfolio')}
                </button>
              </li>

              {SWAP_ENABLED && (
                <li className={location.pathname.startsWith("/swap") ? "active" : ""}>
                  <button
                    type="button"
                    className="nav-link-btn"
                    onClick={() => navigate("/swap")}
                  >
                    {t(language, 'navSwap')}
                  </button>
                </li>
              )}

              <li className={location.pathname.startsWith("/badges") ? "active" : ""}>
                <button
                  type="button"
                  className="nav-link-btn"
                  onClick={() => navigate("/badges")}
                >
                  {t(language, 'navBadges')}
                </button>
              </li>

              <li className={location.pathname.startsWith("/leaderboard") ? "active" : ""}>
                <button
                  type="button"
                  className="nav-link-btn"
                  onClick={() => navigate("/leaderboard")}
                >
                  {t(language, 'navLeaderboard')}
                </button>
              </li>


              <li className="more-dropdown-container">
                <button
                  className={`nav-more-btn ${moreDropdownOpen ? 'active' : ''}`}
                  onClick={handleMoreClick}
                  type="button"
                  aria-expanded={moreDropdownOpen}
                >
                  {t(language, 'navMore')} ▼
                </button>

                {moreDropdownOpen && (
                  <div className="more-dropdown-menu">                    <button
                       className="more-menu-item"
                       onClick={() => {
                         window.open('https://discord.gg/fER9kNyPvk', '_blank', 'noopener,noreferrer');
                         setMoreDropdownOpen(false);
                       }}
                     >
                       <div className="more-menu-icon">
                         <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                           <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 19H11V17H13V19ZM15.07 11.25L14.17 12.17C13.45 12.9 13 13.5 13 15H11V14.5C11 13.4 11.45 12.4 12.17 11.67L13.41 10.41C13.78 10.05 14 9.55 14 9C14 7.9 13.1 7 12 7C10.9 7 10 7.9 10 9H8C8 6.79 9.79 5 12 5C14.21 5 16 6.79 16 9C16 9.88 15.64 10.68 15.07 11.25Z" fill="currentColor" />
                         </svg>
                       </div>
                       <span>{t(language, 'menuSupport')}</span>
                     </button>

                     <button
                       className="more-menu-item"
                       onClick={() => {
                         setFeedbackOpen(true);
                         setMoreDropdownOpen(false);
                       }}
                     >
                       <div className="more-menu-icon">
                         <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                           <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                         </svg>
                       </div>
                       <span>Feedback</span>
                     </button>

                    {/* Theme option removed - locked to premium dark-gold */}

                    <button
                      className="more-menu-item"
                      onClick={() => {
                        navigate('/settings');
                        setMoreDropdownOpen(false);
                      }}
                    >
                      <div className="more-menu-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.11-.2-.36-.28-.57-.2l-2.39.96c-.5-.38-1.04-.7-1.64-.94l-.36-2.54c-.03-.22-.22-.38-.44-.38h-3.84c-.22 0-.41.16-.44.38l-.36 2.54c-.6.24-1.14.56-1.64.94l-2.39-.96c-.21-.08-.46 0-.57.2l-1.92 3.32c-.11.2-.06.47.12.61l2.03 1.58c-.05.31-.07.62-.07.94 0 .31.02.63.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.11.2.36.28.57.2l2.39-.96c.5.38 1.04.7 1.64.94l.36 2.54c.03.22.22.38.44.38h3.84c.22 0 .41-.16.44-.38l.36-2.54c.6-.24 1.14-.56 1.64-.94l2.39.96c.21.08.46 0 .57-.2l1.92-3.32c.11-.2.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.99 0-3.6-1.61-3.6-3.6s1.61-3.6 3.6-3.6 3.6 1.61 3.6 3.6-1.61 3.6-3.6 3.6z" fill="currentColor" />
                        </svg>
                      </div>
                      <span>{t(language, 'menuSettings')}</span>
                      <div className="more-menu-arrow">→</div>
                    </button>

                    <button
                      className="more-menu-item"
                      onClick={handleResourcesDownload}
                    >
                      <div className="more-menu-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M20 6H12L10 4H4C2.9 4 2.01 4.9 2.01 6L2 18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V8C22 6.9 21.1 6 20 6ZM20 18H4V8H20V18Z" fill="currentColor" />
                        </svg>
                      </div>
                      <span>{t(language, 'menuResources')}</span>
                      <div className="more-menu-arrow">→</div>
                    </button>

                    <div className="more-menu-divider"></div>

                    <div className="more-menu-social">
                      <a href="https://x.com/Daftar_xyz" target="_blank" rel="noopener noreferrer" className="social-icon" aria-label="X">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                      </a>
                      <a href="https://discord.gg/fER9kNyPvk" target="_blank" rel="noopener noreferrer" className="social-icon" aria-label="Discord">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
                        </svg>
                      </a>
                      <a href="https://t.me/daftarfi" target="_blank" rel="noopener noreferrer" className="social-icon" aria-label="Telegram">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
                        </svg>
                      </a>
                    </div>

                    <div className="more-menu-footer">
                      <button
                        type="button"
                        className="more-menu-footer-link"
                        onClick={() => {
                          navigate('/terms');
                          setMoreDropdownOpen(false);
                        }}
                      >
                        Terms Of Service
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        className="more-menu-footer-link"
                        onClick={() => {
                          navigate('/privacy');
                          setMoreDropdownOpen(false);
                        }}
                      >
                        Privacy Policy
                      </button>
                    </div>
                  </div>
                )}
              </li>

            </ul>
          </div>

          <div className="nav-right">
            <div className="search-wrapper">
              <div className={`search-bar ${searchError ? 'search-error' : ''} ${showSuggestions && searchQuery.trim() ? 'search-active' : ''}`}>
                <svg className="search-icon-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  placeholder={t(language, 'searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setSearchQuery(nextValue);
                    setSearchError(null);
                    setActiveSuggestionIndex(-1);
                    const query = nextValue.trim();
                    if (!query) {
                      setSearchResults([]);
                      setSearchLoading(false);
                    } else {
                      setSearchLoading(true);
                    }
                    if (!showSuggestions) setShowSuggestions(true);
                  }}
                  onFocus={() => {
                    if (blurTimeoutRef.current) {
                      clearTimeout(blurTimeoutRef.current);
                      blurTimeoutRef.current = null;
                    }
                    setShowSuggestions(true);
                    setActiveSuggestionIndex(-1);
                  }}
                  onBlur={() => {
                    blurTimeoutRef.current = setTimeout(() => {
                      setShowSuggestions(false);
                      setActiveSuggestionIndex(-1);
                    }, 250);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const currentSuggestions = searchQuery.trim() ? searchResults : recentSearches;
                      if (showSuggestions && activeSuggestionIndex >= 0 && activeSuggestionIndex < currentSuggestions.length) {
                        const selected = currentSuggestions[activeSuggestionIndex];
                        goToWallet(selected.address, selected.username, selected.type);
                      } else {
                        handleSearch();
                      }
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (!showSuggestions) {
                        setShowSuggestions(true);
                        return;
                      }
                      const currentSuggestions = searchQuery.trim() ? searchResults : recentSearches;
                      if (currentSuggestions.length === 0) return;
                      setActiveSuggestionIndex((prev) => (prev + 1) % currentSuggestions.length);
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (!showSuggestions) return;
                      const currentSuggestions = searchQuery.trim() ? searchResults : recentSearches;
                      if (currentSuggestions.length === 0) return;
                      setActiveSuggestionIndex((prev) => (prev <= 0 ? currentSuggestions.length - 1 : prev - 1));
                    }
                    if (e.key === "Escape") {
                      setShowSuggestions(false);
                      setActiveSuggestionIndex(-1);
                      (e.target as HTMLElement).blur();
                    }
                  }}
                />
                {searchLoading && (
                  <div className="search-spinner" />
                )}
                {searchQuery.trim() && !searchLoading && (
                  <button
                    className="search-clear-btn"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSearchQuery("");
                      setSearchResults([]);
                      setSearchLoading(false);
                      setSearchError(null);
                    }}
                    aria-label="Clear search"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {searchError && (
                <div className="search-error-msg">{searchError}</div>
              )}

              {showSuggestions && (
                <div className="search-suggestions">
                  {!searchQuery.trim() && recentSearches.length > 0 && (
                    <>
                      <div className="search-suggestion-header">
                        <span>{t(language, 'recentSearches')}</span>
                        <button
                          className="search-clear-all-btn"
                          onMouseDown={handleClearRecentSearches}
                          type="button"
                        >
                          {t(language, 'clearAll') || 'Clear'}
                        </button>
                      </div>
                      {recentSearches.map((item, i) => {
                        const address = typeof item === 'string' ? item : item.address;
                        const displayName = typeof item === 'string' ? formatAddress(item, 8, 6) : item.name;
                        const isHighlighted = activeSuggestionIndex === i;
                        return (
                          <button
                            key={`recent-${address}-${i}`}
                            className={`search-suggestion-item recent-search ${isHighlighted ? 'highlighted' : ''}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              goToWallet(address, displayName);
                            }}
                          >
                            <div className="suggestion-avatar recent">
                              <span className="suggestion-icon recent-icon">🕐</span>
                            </div>
                            <div className="suggestion-info">
                              <div className="suggestion-main">
                                <span className="suggestion-name">{displayName}</span>
                                <span className="suggestion-badge recent">Recent</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}
                  {searchQuery.trim() && (
                    <>
                      {searchLoading && searchResults.length === 0 && (
                        <div className="search-suggestion-loading">
                          <div className="search-spinner-sm" />
                          <span>{t(language, 'searchBlockchain')}</span>
                        </div>
                      )}
                      {searchResults.length > 0 ? (
                        searchResults.map((result, i) => {
                          const isHighlighted = activeSuggestionIndex === i;
                          const hasValidAvatar = isValidAvatarUrl(result.pfp);
                          return (
                             <button
                              key={`${result.type}-${result.address}-${i}`}
                              className={`search-suggestion-item ${isHighlighted ? 'highlighted' : ''}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                goToWallet(result.address, result.username, result.type);
                              }}
                            >
                              <div className="suggestion-avatar">
                                {result.type === 'transaction' ? (
                                  <span className="suggestion-icon">⛓️</span>
                                ) : (
                                  <img src={hasValidAvatar ? result.pfp : '/pfp/default.png'} alt={`${result.username} profile`} className="suggestion-pfp" />
                                )}
                              </div>
                              <div className="suggestion-info">
                                <div className="suggestion-main">
                                  <span className="suggestion-name">{result.username}</span>
                                  <span className={`suggestion-badge ${result.type}`}>
                                    {result.type === 'blockchain' ? `✓ ${t(language, 'onChain')}`
                                      : result.type === 'profile' ? t(language, 'profile')
                                        : result.type === 'platform' ? (result.category || 'Platform')
                                          : result.type === 'transaction' ? 'Transaction'
                                            : t(language, 'address')}
                                  </span>
                                </div>
                                <span className="suggestion-address">{formatAddress(result.address, 10, 6)}</span>
                              </div>
                            </button>
                          );
                        })
                      ) : !searchLoading ? (
                        <div className="search-suggestion-empty">
                          {isValidAddress(searchQuery.trim()) ? (
                            <button
                              className="search-go-btn"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                goToWallet(searchQuery.trim(), searchQuery.trim());
                              }}
                            >
                              <span>🔍</span>
                              <span>{t(language, 'lookupOnChain', { address: formatAddress(searchQuery.trim()) })}</span>
                            </button>
                          ) : (
                            <span>{t(language, 'noProfilesFound')}</span>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="nav-pass-inline">
              <button
                type="button"
                className="nav-pass-pill"
                onClick={() => navigate("/level")}
                aria-label="Level"
              >
                <span className="nav-pass-text">Level</span>
                <span className="nav-pass-level">{passLevelLoading ? '•' : passLevel}</span>
              </button>
            </div>

            {connected && account ? (
              <div className="wallet-dropdown-container">
                <button
                  className={`connect-btn connected ${walletDropdownOpen ? 'active' : ''}`}
                  type="button"
                  onClick={handleWalletClick}
                >
                  {wallet?.name && getWalletLogo(wallet.name) ? (
                    <img src={getWalletLogo(wallet.name)} alt={wallet.name} className="wallet-status-logo" />
                  ) : (
                    <span className="wallet-status-dot"></span>
                  )}
                  {formatAddress(account.address) || "Connected"}
                </button>

                {walletDropdownOpen && (
                  <div className="wallet-dropdown">
                    <button
                      className="wallet-menu-item"
                      onClick={() => {
                        navigate('/profile');
                        setWalletDropdownOpen(false);
                      }}
                    >
                      <div className="wallet-menu-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z" fill="currentColor" />
                        </svg>
                      </div>
                      {t(language, 'profile')}
                    </button>
                    <div className="dropdown-divider"></div>
                    <button
                      className="wallet-menu-item disconnect"
                      onClick={() => {
                        disconnect();
                        setWalletDropdownOpen(false);
                      }}
                    >
                      <div className="wallet-menu-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 17l1.41-1.41L8.83 13H20v-2H8.83l2.58-2.59L10 7l-5 5 5 5z" fill="currentColor" />
                        </svg>
                      </div>
                      {t(language, 'disconnect')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="wallet-picker-container">
                <button className={`connect-btn ${walletPickerOpen ? 'active' : ''}`} type="button" onClick={handleConnect}>
                  {t(language, 'connectWallet')}
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Page Content */}
      <main className="main-content">
        {children}
      </main>

      {/* Static Footer */}
      <footer className="app-footer">
        <div className="footer-inner">
          <div className="footer-left">
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
            <span className="status-text">
              {connected && account?.address ? (
                `${formatAddress(account.address, 6, 4)} — ${formattedNetWorth}`
              ) : (
                'Disconnected'
              )}
            </span>
          </div>
          <div className="footer-right">
            <button 
              type="button" 
              className="footer-btn"
              onClick={() => {
                setBugReportParams({ type: 'general', symbol: '', address: '' });
                setBugReportOpen(true);
              }}
              title="Report a bug"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="footer-btn-icon">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Bug</span>
            </button>
            <button 
              type="button" 
              className="footer-btn"
              onClick={() => setFeedbackOpen(true)}
              title="Share your feedback"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="footer-btn-icon">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Feedback</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Feedback Modal */}
      <FeedbackModal isOpen={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* Bug Report Modal */}
      <BugReportModal 
        isOpen={bugReportOpen} 
        onClose={() => setBugReportOpen(false)} 
        initialType={bugReportParams.type}
        initialSymbol={bugReportParams.symbol}
        initialAddress={bugReportParams.address}
        initialDescription={bugReportParams.description}
      />

      {/* Wallet Connection Modal */}
      <WalletModal isOpen={walletPickerOpen} onClose={() => setWalletPickerOpen(false)} />

      {selectedTxForPlayback && (
        <TransactionVisualizer
          tx={selectedTxForPlayback}
          onClose={() => setSelectedTxForPlayback(null)}
          language={language}
        />
      )}
    </div>
  );
}
