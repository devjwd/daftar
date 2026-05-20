import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { isValidAddress, formatAddress } from '../utils/tokenUtils';
import { getStoredLanguagePreference, t } from '../utils/language';
import { resolveAddressOrUsernameAsync, searchProfiles, searchProfilesAsync } from '../services/profileService';
import { checkAccountExists } from '../services/indexer';
import { searchEntities } from '../services/entityStore';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const { connected, account, connect, wallets } = useWallet();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [language, setLanguage] = useState(() => getStoredLanguagePreference());

  useEffect(() => {
    const syncLanguage = () => setLanguage(getStoredLanguagePreference());
    const onLanguageChange = (event) => {
      if (event?.detail?.language) {
        setLanguage(event.detail.language);
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

  const handleConnectWallet = async (walletName) => {
    try {
      await connect(walletName);
      setShowWalletPicker(false);
      // Navigate to portfolio after successful connection
      if (connected && account) {
        navigate(`/wallet/${account.address}`);
      }
    } catch (err) {
      console.error("Wallet connect failed", err);
    }
  };

  // Navigate to portfolio when wallet connects
  useEffect(() => {
    if (connected && account) {
      navigate(`/wallet/${account.address}`);
    }
  }, [connected, account, navigate]);

  const [searchLoading, setSearchLoading] = useState(false);

  // Recommendations Dropdown State
  const [searchResults, setSearchResults] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const blurTimeoutRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const latestQueryRef = useRef("");

  const isValidAvatarUrl = (url) => {
    if (!url) return false;
    const trimmed = url.trim();
    return trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('/');
  };

  const goToWallet = useCallback((address, name) => {
    if (!address) return;
    const addr = address.trim();
    try {
      const indexData = localStorage.getItem('recentSearches');
      let index = indexData ? JSON.parse(indexData) : [];
      index = index.filter(item => item.address?.toLowerCase() !== addr.toLowerCase());
      index.unshift({ address: addr, name: name || formatAddress(addr, 8, 6), timestamp: Date.now() });
      localStorage.setItem('recentSearches', JSON.stringify(index.slice(0, 5)));
    } catch (e) {
      console.warn("Failed to save recent search:", e);
    }
    
    navigate(`/profile/${addr}`);
    setSearchQuery("");
    setShowSuggestions(false);
    setSearchResults([]);
  }, [navigate]);

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
        pfp: profile.avatar_url || profile.pfp || null,
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

    return {
      isAddress: false,
      profileMatches: combinedResults,
      alreadyInResults: false,
      results: combinedResults,
    };
  }, []);

  // Keep latest query in ref
  useEffect(() => {
    latestQueryRef.current = searchQuery;
  }, [searchQuery]);

  // Debounced search logic for recommendations
  useEffect(() => {
    const query = searchQuery.trim();

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    if (!query) {
      setSearchResults([]);
      setSuggestionsLoading(false);
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
          setSuggestionsLoading(false);
          setActiveSuggestionIndex(-1);
          return;
        }

        setSuggestionsLoading(true);
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
        setSuggestionsLoading(false);
        setActiveSuggestionIndex(-1);
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn("Home suggestions lookup error:", err);
        if (latestQueryRef.current === query && !signal.aborted) {
          setSearchResults(localResults);
          setSuggestionsLoading(false);
          setActiveSuggestionIndex(-1);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, buildLocalSearchResults]);

  // Clean up blur timeouts
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const handleKeyDown = (e) => {
    if (!showSuggestions || searchResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestionIndex((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestionIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter") {
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < searchResults.length) {
        e.preventDefault();
        const selected = searchResults[activeSuggestionIndex];
        goToWallet(selected.address, selected.username);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    const query = searchQuery.trim();

    if (!query) {
      setSearchError(t(language, 'searchErrorEmpty'));
      return;
    }

    setSearchError('');

    if (isValidAddress(query)) {
      navigate(`/profile/${query}`);
      return;
    }

    // Try resolving username
    setSearchLoading(true);
    try {
      const resolvedAddress = await resolveAddressOrUsernameAsync(query);
      if (resolvedAddress) {
        navigate(`/profile/${resolvedAddress}`);
      } else {
        setSearchError(t(language, 'searchErrorInvalid') || 'Invalid address or username');
      }
    } catch (error) {
      console.error("Home page search resolution failed:", error);
      setSearchError(t(language, 'searchErrorInvalid') || 'Invalid address or username');
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <div className="home-page">
      {/* Background decorative elements */}
      <div className="home-background">
        <div className="gradient-orb orb-1"></div>
        <div className="gradient-orb orb-2"></div>
        <div className="gradient-orb orb-3"></div>
        <div className="grid-overlay"></div>
      </div>

      <div className="home-hero">
        <div className="home-content">
          {/* Hero Section */}
          <div className="home-hero-section">
            <div className="home-logo-container">
              <img src="/logo.png" alt="Movement Network" className="home-logo" />
            </div>

            <h1 className="home-title">
              {t(language, 'homeTitleLead')}
              <span className="title-gradient">{t(language, 'homeTitleAccent')}</span>
            </h1>

            <p className="home-subtitle">
              {t(language, 'homeSubtitle')}
            </p>

            <div className="home-stats">
              <div className="stat-item">
                <div className="stat-value">10+</div>
                <div className="stat-label">{t(language, 'homeProtocolsSupported')}</div>
              </div>
              <div className="stat-divider"></div>
              <div className="stat-item">
                <div className="stat-value">Real-time</div>
                <div className="stat-label">{t(language, 'homeRealtimeData')}</div>
              </div>
              <div className="stat-divider"></div>
              <div className="stat-item">
                <div className="stat-value">24/7</div>
                <div className="stat-label">{t(language, 'homePortfolioTracking')}</div>
              </div>
            </div>
          </div>

          {/* Action Section */}
          <div className="home-action-section">
            <form onSubmit={handleSearch} className="home-search-form" onKeyDown={handleKeyDown}>
              <div className={`home-search-wrapper ${searchError ? 'error' : ''}`}>
                <svg className="home-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  placeholder={t(language, 'searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchError('');
                  }}
                  onFocus={() => {
                    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                    setShowSuggestions(true);
                  }}
                  onBlur={() => {
                    blurTimeoutRef.current = setTimeout(() => setShowSuggestions(false), 250);
                  }}
                  className="home-search-input"
                  disabled={searchLoading}
                />
                <button type="submit" className="home-search-btn" disabled={searchLoading}>
                  {searchLoading ? (
                    <div className="home-search-spinner" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Suggestions Dropdown */}
              {showSuggestions && (searchQuery.trim().length > 0) && (searchResults.length > 0 || suggestionsLoading) && (
                <div className="search-suggestions home-search-suggestions" aria-label="Search suggestions">
                  {suggestionsLoading && searchResults.length === 0 ? (
                    <div className="search-suggestion-loading">
                      <div className="home-search-spinner" style={{ borderTopColor: '#deb884' }} />
                      <span>{t(language, 'searching') || 'Searching...'}</span>
                    </div>
                  ) : (
                    searchResults.map((result, i) => {
                      const isHighlighted = activeSuggestionIndex === i;
                      const hasValidAvatar = isValidAvatarUrl(result.pfp);
                      return (
                        <button
                          key={`${result.type}_${result.address}_${i}`}
                          type="button"
                          className={`search-suggestion-item ${isHighlighted ? 'highlighted' : ''}`}
                          onClick={() => goToWallet(result.address, result.username)}
                          onMouseEnter={() => setActiveSuggestionIndex(i)}
                        >
                          {/* Avatar/Icon */}
                          <div className="suggestion-avatar">
                            {result.type === 'profile' && hasValidAvatar ? (
                              <img
                                src={result.pfp}
                                alt={result.username}
                                className="suggestion-pfp"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = '/pfp/default.png';
                                }}
                              />
                            ) : result.type === 'platform' && hasValidAvatar ? (
                              <img
                                src={result.pfp}
                                alt={result.username}
                                className="suggestion-pfp"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = '/movement-logo.svg';
                                }}
                              />
                            ) : (
                              <span className={`suggestion-icon ${result.type}`}>
                                {result.type === 'blockchain' ? '⛓️' : result.type === 'profile' ? '👤' : '🎟️'}
                              </span>
                            )}
                          </div>

                          {/* Info */}
                          <div className="suggestion-info">
                            <div className="suggestion-main">
                              <span className="suggestion-name">{result.username}</span>
                              <span className={`suggestion-badge ${result.type}`}>
                                {result.type === 'blockchain' ? `✓ ${t(language, 'onChain')}`
                                  : result.type === 'profile' ? t(language, 'profile')
                                    : result.type === 'platform' ? (result.category || 'Platform')
                                      : t(language, 'address')}
                              </span>
                            </div>
                            <span className="suggestion-address">
                              {formatAddress(result.address, 10, 8)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
              {searchError && (
                <p className="home-search-error">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {searchError}
                </p>
              )}
            </form>

            <div className="home-divider">
              <span className="home-divider-text">{t(language, 'homeConnectWalletPrompt')}</span>
            </div>

            <div className="home-wallet-section">
              <button
                className="home-connect-btn"
                type="button"
                onClick={() => setShowWalletPicker(!showWalletPicker)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="18" height="14" rx="2" />
                  <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <circle cx="16" cy="14" r="1" fill="currentColor" />
                </svg>
                <span>{t(language, 'connectWallet')}</span>
              </button>

              {showWalletPicker && (
                <div className="home-wallet-picker">
                  <div className="wallet-picker-header">
                    <h4>{t(language, 'homeChooseWallet')}</h4>
                    <button className="wallet-close" type="button" onClick={() => setShowWalletPicker(false)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  <div className="wallet-picker-list">
                    {wallets
                      .filter((wallet) => !wallet.name.includes('Google') && !wallet.name.includes('Apple'))
                      .map((wallet) => {
                        const getWalletLogo = (name) => {
                          const lowerName = name.toLowerCase();
                          if (lowerName.includes('okx')) return '/okx.png';
                          if (lowerName.includes('leap')) return '/leap.png';
                          if (lowerName.includes('razor')) return '/razor.png';
                          if (lowerName.includes('nightly')) return '/nightly.png';
                          if (lowerName.includes('petra')) return '/logo.png';
                          return null;
                        };
                        const logo = getWalletLogo(wallet.name);
                        return (
                          <button
                            key={wallet.name}
                            className="home-wallet-option"
                            type="button"
                            onClick={() => handleConnectWallet(wallet.name)}
                          >
                            <div className="wallet-option-content">
                              {logo ? (
                                <img src={logo} alt={wallet.name} className="wallet-option-logo" />
                              ) : (
                                <div className="wallet-option-placeholder">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="7" width="18" height="14" rx="2" />
                                    <circle cx="16" cy="14" r="1" fill="currentColor" />
                                  </svg>
                                </div>
                              )}
                              <span>{wallet.name}</span>
                            </div>
                            <svg className="wallet-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Features Section */}
          <div className="home-features">
            <div className="home-feature">
              <div className="home-feature-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="20" x2="12" y2="10" />
                  <line x1="18" y1="20" x2="18" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="16" />
                </svg>
              </div>
              <h3>{t(language, 'homeFeatureAnalyticsTitle')}</h3>
              <p>{t(language, 'homeFeatureAnalyticsDesc')}</p>
            </div>

            <div className="home-feature">
              <div className="home-feature-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </div>
              <h3>{t(language, 'homeFeatureDefiTitle')}</h3>
              <p>{t(language, 'homeFeatureDefiDesc')}</p>
            </div>

            <div className="home-feature">
              <div className="home-feature-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              </div>
              <h3>{t(language, 'homeFeaturePricesTitle')}</h3>
              <p>{t(language, 'homeFeaturePricesDesc')}</p>
            </div>

            <div className="home-feature">
              <div className="home-feature-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v6m0 6v6m5.2-13.2l-4.2 4.2m0 6l4.2 4.2M1 12h6m6 0h6m-13.2 5.2l4.2-4.2m0-6l-4.2-4.2" />
                </svg>
              </div>
              <h3>{t(language, 'homeFeatureSwapTitle')}</h3>
              <p>{t(language, 'homeFeatureSwapDesc')}</p>
            </div>
          </div>
        </div>
      </div>

      <footer className="home-footer-min" aria-label="Home footer">
        <span>{t(language, 'homeFooterTitle')}</span>
        <span>•</span>
        <span>{t(language, 'homeFooterBuiltOn')}</span>
      </footer>
    </div>
  );
}
