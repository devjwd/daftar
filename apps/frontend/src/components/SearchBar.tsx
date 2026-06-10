import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { isValidAddress, formatAddress } from '../utils/tokenUtils';
import { t } from '../utils/language';
import {
  resolveAddressOrUsernameAsync,
  searchProfilesAsync,
  getProfileAsync,
  resolveAddressOrUsername,
  searchProfiles,
  getProfile,
} from '../services/profileService';
import { checkAccountExists } from '../services/indexer';
import { searchEntities } from '../services/entityStore';

interface SearchBarProps {
  variant?: 'layout' | 'home';
  language?: string;
}

export function SearchBar({ variant = 'layout', language = 'en' }: SearchBarProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [recentSearches, setRecentSearches] = useState<any[]>(() => {
    const saved = localStorage.getItem('recentSearches');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  });

  const searchTimeoutRef = useRef<any>(null);
  const latestQueryRef = useRef("");
  const blurTimeoutRef = useRef<any>(null);

  const isHome = variant === 'home';

  const isValidAvatarUrl = (url: string) => {
    if (!url) return false;
    const normalized = String(url).trim().toLowerCase();
    return normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('/');
  };

  const saveRecentSearch = useCallback((address: string, name: string) => {
    if (!address || !isValidAddress(address)) return;

    setRecentSearches((prev) => {
      let displayName = name && name !== 'Wallet address' && name !== 'User' ? name : formatAddress(address, 8, 6);
      if (!displayName || displayName.length < 2) {
        displayName = formatAddress(address, 8, 6);
      }

      const filtered = prev.filter(item => {
        const itemAddr = typeof item === 'string' ? item : item.address;
        return itemAddr.toLowerCase() !== address.toLowerCase();
      });

      const newItem = { address, name: displayName, timestamp: Date.now() };
      const updated = [newItem, ...filtered].slice(0, 5);
      localStorage.setItem('recentSearches', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleClearRecentSearches = useCallback((e: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setRecentSearches([]);
    localStorage.removeItem('recentSearches');
  }, []);

  const goToWallet = useCallback(async (address: string, name: string, type?: string) => {
    if (!address) return;
    const addr = address.trim();
    saveRecentSearch(addr, name);
    navigate(`/profile/${addr}`);
    setSearchQuery("");
    setShowSuggestions(false);
    setSearchResults([]);
    setSearchError(null);
  }, [navigate, saveRecentSearch]);

  const buildLocalSearchResults = useCallback(async (query: string, signal?: AbortSignal) => {
    const remoteProfiles = await searchProfilesAsync(query, signal);
    const profiles = Array.isArray(remoteProfiles) && remoteProfiles.length > 0
      ? remoteProfiles
      : searchProfiles(query);

    const profileMatches = profiles
      .slice(0, 5)
      .map((profile: any) => ({
        type: 'profile',
        address: profile.address,
        username: profile.username || formatAddress(profile.address, 8, 6),
        pfp: profile.avatar_url || profile.pfp || null,
      }));

    const entityMatches = searchEntities(query).map((entity: any) => ({
      type: 'platform',
      address: entity.address,
      username: entity.name,
      pfp: entity.logo_url || '/movement-logo.svg',
      category: entity.category || 'Platform'
    }));

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
        pfp: existingProfile?.avatar_url || existingProfile?.pfp || null,
      });
    }

    return {
      isAddress: false,
      profileMatches: combinedResults,
      alreadyInResults: false,
      results: combinedResults,
    };
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    latestQueryRef.current = query;

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
      let localResults: any[] = [];
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
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn("Blockchain/profile lookup error:", err);
        if (latestQueryRef.current === query && !signal.aborted) {
          setSearchResults(localResults);
          setSearchLoading(false);
          setActiveSuggestionIndex(-1);
        }
      }
    }, isHome ? 250 : 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      controller.abort();
    };
  }, [searchQuery, buildLocalSearchResults, isHome]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      if (isHome) setSearchError(t(language, 'searchErrorEmpty') || 'Please enter an address');
      return;
    }

    if (isValidAddress(query)) {
      goToWallet(query, 'Wallet address');
      return;
    }

    setSearchLoading(true);
    try {
      const resolvedAddress = await resolveAddressOrUsernameAsync(query) || resolveAddressOrUsername(query);
      if (resolvedAddress) {
        const profile = await getProfileAsync(resolvedAddress) || getProfile(resolvedAddress);
        goToWallet(resolvedAddress, profile?.username || query);
        return;
      }
    } catch (error) {
      console.error("Search resolution failed:", error);
    } finally {
      setSearchLoading(false);
    }

    if (searchResults.length > 0 && searchResults[0].address) {
      goToWallet(searchResults[0].address, searchResults[0].username, searchResults[0].type);
      return;
    }

    setSearchError(isHome ? (t(language, 'searchErrorInvalid') || 'Invalid address or username') : "Enter a valid 0x address or username");
    if (!isHome) {
      setTimeout(() => setSearchError(null), 3000);
    }
  }, [searchQuery, searchResults, goToWallet, isHome, language]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentSuggestions = searchQuery.trim() ? searchResults : recentSearches;

    if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && activeSuggestionIndex >= 0 && activeSuggestionIndex < currentSuggestions.length) {
        const selected = currentSuggestions[activeSuggestionIndex];
        const addr = typeof selected === 'string' ? selected : selected.address;
        const name = typeof selected === 'string' ? selected : selected.username || selected.name;
        goToWallet(addr, name, selected.type);
      } else {
        handleSearch();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!showSuggestions) {
        setShowSuggestions(true);
        return;
      }
      if (currentSuggestions.length === 0) return;
      setActiveSuggestionIndex((prev) => (prev + 1) % currentSuggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!showSuggestions) return;
      if (currentSuggestions.length === 0) return;
      setActiveSuggestionIndex((prev) => (prev <= 0 ? currentSuggestions.length - 1 : prev - 1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
      (e.target as HTMLElement).blur();
    }
  };

  const renderSuggestions = () => {
    if (!showSuggestions) return null;

    return (
      <div className={`search-suggestions ${isHome ? 'home-search-suggestions' : ''}`} aria-label="Search suggestions">
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
                  onMouseEnter={() => setActiveSuggestionIndex(i)}
                  type="button"
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
                <div className={isHome ? "home-search-spinner" : "search-spinner-sm"} style={isHome ? { borderTopColor: '#deb884' } : {}} />
                <span>{isHome ? (t(language, 'searching') || 'Searching...') : t(language, 'searchBlockchain')}</span>
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
                    onMouseEnter={() => setActiveSuggestionIndex(i)}
                    type="button"
                  >
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
                      ) : result.type === 'transaction' ? (
                        <span className="suggestion-icon">⛓️</span>
                      ) : (
                        <span className={`suggestion-icon ${result.type}`}>
                          {result.type === 'blockchain' ? '⛓️' : result.type === 'profile' ? '👤' : '🎟️'}
                        </span>
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
                      <span className="suggestion-address">{formatAddress(result.address, 10, isHome ? 8 : 6)}</span>
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
                    type="button"
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
    );
  };

  if (isHome) {
    return (
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
              setSearchError(null);
              setActiveSuggestionIndex(-1);
              if (!showSuggestions) setShowSuggestions(true);
            }}
            onFocus={() => {
              if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
              setShowSuggestions(true);
              setActiveSuggestionIndex(-1);
            }}
            onBlur={() => {
              blurTimeoutRef.current = setTimeout(() => {
                setShowSuggestions(false);
                setActiveSuggestionIndex(-1);
              }, 250);
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
        {renderSuggestions()}
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
    );
  }

  // Layout variant
  return (
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
          onKeyDown={handleKeyDown}
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
            type="button"
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

      {renderSuggestions()}
    </div>
  );
}
