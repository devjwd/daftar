import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { formatAddress, isValidAddress } from '../utils/tokenUtils';
import { resolveAddressOrUsername, searchProfiles, getProfile } from '../services/profileService';
import { checkAccountExists } from '../services/indexer';
import './Layout.css';

const logo = "/logo.png";

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { connect, disconnect, account, connected, wallets } = useWallet();
  
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [moreDropdownOpen, setMoreDropdownOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const [walletDropdownStyle, setWalletDropdownStyle] = useState({});
  const moreContainerRef = useRef(null);
  const walletContainerRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [recentSearches, setRecentSearches] = useState([]);
  const searchTimeoutRef = useRef(null);
  const latestQueryRef = useRef("");

  // Load recent searches from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('recentSearches');
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch (_e) {
        setRecentSearches([]);
      }
    }
  }, []);

  // Save search to recent searches
  const saveRecentSearch = useCallback((address) => {
    setRecentSearches((prev) => {
      // Remove if already exists
      const filtered = prev.filter(a => a.toLowerCase() !== address.toLowerCase());
      // Add to front
      const updated = [address, ...filtered].slice(0, 5);
      localStorage.setItem('recentSearches', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (walletDropdownOpen && !event.target.closest('.wallet-dropdown-container')) {
        setWalletDropdownOpen(false);
      }
      if (walletPickerOpen && !event.target.closest('.wallet-picker-container')) {
        setWalletPickerOpen(false);
      }
      if (moreDropdownOpen && !event.target.closest('.more-dropdown-container')) {
        setMoreDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [walletDropdownOpen, walletPickerOpen, moreDropdownOpen]);

  const handleMoreClick = useCallback(() => {
    setMoreDropdownOpen(prev => {
      if (!prev && moreContainerRef.current) {
        const rect = moreContainerRef.current.getBoundingClientRect();
        setDropdownStyle({
          top: rect.bottom + 12,
          left: rect.left,
        });
      }
      return !prev;
    });
  }, []);

  const handleWalletClick = useCallback(() => {
    setWalletDropdownOpen(prev => {
      if (!prev && walletContainerRef.current) {
        const rect = walletContainerRef.current.getBoundingClientRect();
        setWalletDropdownStyle({
          top: rect.bottom + 8,
          right: window.innerWidth - rect.right,
        });
      }
      return !prev;
    });
  }, []);

  const handleConnect = () => {
    setWalletPickerOpen(prev => {
      if (!prev && walletContainerRef.current) {
        const rect = walletContainerRef.current.getBoundingClientRect();
        setWalletDropdownStyle({
          top: rect.bottom + 8,
          right: window.innerWidth - rect.right,
        });
      }
      return !prev;
    });
  };

  const handleSelectWallet = async (walletName) => {
    try {
      await connect(walletName);
      setWalletPickerOpen(false);
    } catch (err) {
      console.error("Wallet connect failed", err);
    }
  };

  // Navigate to a wallet address
  const goToWallet = useCallback((address) => {
    if (!address) return;
    const addr = address.trim();
    saveRecentSearch(addr);
    navigate(`/wallet/${addr}`);
    setSearchQuery("");
    setShowSuggestions(false);
    setSearchResults([]);
    setSearchError(null);
  }, [navigate, saveRecentSearch]);

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
      setSearchError(null);
      return;
    }

    // Immediate: local profile matches
    const profileMatches = searchProfiles(query)
      .slice(0, 5)
      .map((profile) => ({
        type: 'profile',
        address: profile.address,
        username: profile.username || 'User',
        pfp: profile.pfp || null,
      }));

    // If query is a valid blockchain address
    if (isValidAddress(query)) {
      const alreadyInProfiles = profileMatches.some(
        (p) => p.address?.toLowerCase() === query.toLowerCase()
      );

      // Show address entry immediately so user can click it right away
      const immediateResults = [...profileMatches];
      if (!alreadyInProfiles) {
        immediateResults.unshift({
          type: 'address',
          address: query,
          username: 'Wallet address',
          verified: false,
        });
      }
      setSearchResults(immediateResults);
      setSearchLoading(true);

      // Debounce blockchain check
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const { exists, txCount } = await checkAccountExists(query);
          // Only update if query hasn't changed
          if (latestQueryRef.current === query) {
            const results = [...profileMatches];
            if (!alreadyInProfiles) {
              results.unshift({
                type: exists ? 'blockchain' : 'address',
                address: query,
                username: exists ? `${txCount} transaction${txCount !== 1 ? 's' : ''}` : 'Wallet address',
                verified: exists,
              });
            }
            setSearchResults(results);
            setSearchLoading(false);
          }
        } catch (err) {
          console.warn("Blockchain lookup error:", err);
          if (latestQueryRef.current === query) {
            setSearchLoading(false);
          }
        }
      }, 400);
    } else {
      // Not an address — try username resolution
      const resolved = resolveAddressOrUsername(query);
      if (resolved && !profileMatches.some(p => p.address?.toLowerCase() === resolved.toLowerCase())) {
        const existingProfile = getProfile(resolved);
        profileMatches.unshift({
          type: 'profile',
          address: resolved,
          username: existingProfile?.username || query,
          pfp: existingProfile?.pfp || null,
        });
      }
      setSearchResults(profileMatches);
      setSearchLoading(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, [searchQuery]);

  // Search on Enter or button click
  const handleSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (!query) return;
    
    // If valid address, navigate directly
    if (isValidAddress(query)) {
      goToWallet(query);
      return;
    }

    // Try to resolve username
    const resolvedAddress = resolveAddressOrUsername(query);
    if (resolvedAddress) {
      goToWallet(resolvedAddress);
      return;
    }

    // If we have any search results, go to first
    if (searchResults.length > 0 && searchResults[0].address) {
      goToWallet(searchResults[0].address);
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
            <div className="logo-container" onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
              <img src={logo} alt="Logo" className="logo-img" />
            </div>
            <ul className="nav-links">
              <li 
                className={location.pathname.startsWith("/wallet/") ? "active" : ""}
                onClick={() => {
                  if (connected && account) {
                    navigate(`/wallet/${account.address}`);
                  } else {
                    navigate("/");
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                PORTFOLIO
              </li>

              <li 
                className={location.pathname === "/swap" ? "active" : ""}
                onClick={() => navigate("/swap")}
                style={{ cursor: "pointer" }}
              >
                SWAP
              </li>

              <li 
                className={location.pathname === "/badges" ? "active" : ""}
                onClick={() => navigate("/badges")}
                style={{ cursor: "pointer" }}
              >
                BADGES
              </li>

              <li 
                className={location.pathname === "/leaderboard" ? "active" : ""}
                onClick={() => navigate("/leaderboard")}
                style={{ cursor: "pointer" }}
              >
                LEADERBOARD
              </li>

              <li className="more-dropdown-container" ref={moreContainerRef}>
                <button 
                  className={`nav-more-btn ${moreDropdownOpen ? 'active' : ''}`}
                  onClick={handleMoreClick}
                  type="button"
                  aria-expanded={moreDropdownOpen}
                >
                  MORE ▼
                </button>

                {moreDropdownOpen && (
                  <div className="more-dropdown-menu" style={{ position: 'fixed', ...dropdownStyle }}>
                    <button 
                      className="more-menu-item"
                      style={{ cursor: 'not-allowed', opacity: 0.6 }}
                    >
                      <div className="more-menu-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 19H11V17H13V19ZM15.07 11.25L14.17 12.17C13.45 12.9 13 13.5 13 15H11V14.5C11 13.4 11.45 12.4 12.17 11.67L13.41 10.41C13.78 10.05 14 9.55 14 9C14 7.9 13.1 7 12 7C10.9 7 10 7.9 10 9H8C8 6.79 9.79 5 12 5C14.21 5 16 6.79 16 9C16 9.88 15.64 10.68 15.07 11.25Z" fill="currentColor"/>
                        </svg>
                      </div>
                      <span>Support</span>
                    </button>

                    <button 
                      className="more-menu-item"
                      onClick={() => {
                        navigate('/settings');
                        setMoreDropdownOpen(false);
                      }}
                    >
                      <div className="more-menu-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 3C11.45 3 11 3.45 11 4V5C11 5.55 11.45 6 12 6C12.55 6 13 5.55 13 5V4C13 3.45 12.55 3 12 3ZM18 12C18 11.45 18.45 11 19 11H20C20.55 11 21 11.45 21 12C21 12.55 20.55 13 20 13H19C18.45 13 18 12.55 18 12ZM6 12C6 11.45 5.55 11 5 11H4C3.45 11 3 11.45 3 12C3 12.55 3.45 13 4 13H5C5.55 13 6 12.55 6 12ZM12 18C11.45 18 11 18.45 11 19V20C11 20.55 11.45 21 12 21C12.55 21 13 20.55 13 20V19C13 18.45 12.55 18 12 18ZM17.66 6.34C17.27 5.95 16.64 5.95 16.25 6.34L15.54 7.05C15.15 7.44 15.15 8.07 15.54 8.46C15.93 8.85 16.56 8.85 16.95 8.46L17.66 7.75C18.05 7.36 18.05 6.73 17.66 6.34ZM6.34 17.66C5.95 17.27 5.95 16.64 6.34 16.25L7.05 15.54C7.44 15.15 8.07 15.15 8.46 15.54C8.85 15.93 8.85 16.56 8.46 16.95L7.75 17.66C7.36 18.05 6.73 18.05 6.34 17.66ZM8.46 8.46C8.85 8.07 8.85 7.44 8.46 7.05L7.75 6.34C7.36 5.95 6.73 5.95 6.34 6.34C5.95 6.73 5.95 7.36 6.34 7.75L7.05 8.46C7.44 8.85 8.07 8.85 8.46 8.46ZM12 9C10.34 9 9 10.34 9 12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12C15 10.34 13.66 9 12 9Z" fill="currentColor"/>
                        </svg>
                      </div>
                      <span>Theme</span>
                      <div className="more-menu-arrow">→</div>
                    </button>

                    <button 
                      className="more-menu-item"
                      onClick={() => {
                        navigate('/settings');
                        setMoreDropdownOpen(false);
                      }}
                    >
                      <div className="more-menu-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.11-.2-.36-.28-.57-.2l-2.39.96c-.5-.38-1.04-.7-1.64-.94l-.36-2.54c-.03-.22-.22-.38-.44-.38h-3.84c-.22 0-.41.16-.44.38l-.36 2.54c-.6.24-1.14.56-1.64.94l-2.39-.96c-.21-.08-.46 0-.57.2l-1.92 3.32c-.11.2-.06.47.12.61l2.03 1.58c-.05.31-.07.62-.07.94 0 .31.02.63.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.11.2.36.28.57.2l2.39-.96c.5.38 1.04.7 1.64.94l.36 2.54c.03.22.22.38.44.38h3.84c.22 0 .41-.16.44-.38l.36-2.54c.6-.24 1.14-.56 1.64-.94l2.39.96c.21.08.46 0 .57-.2l1.92-3.32c.11-.2.06-.47-.12-.61l-2.03-1.58zM12 15.6c-1.99 0-3.6-1.61-3.6-3.6s1.61-3.6 3.6-3.6 3.6 1.61 3.6 3.6-1.61 3.6-3.6 3.6z" fill="currentColor"/>
                        </svg>
                      </div>
                      <span>Settings</span>
                      <div className="more-menu-arrow">→</div>
                    </button>

                    <button 
                      className="more-menu-item"
                      style={{ cursor: 'not-allowed', opacity: 0.6 }}
                    >
                      <div className="more-menu-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M20 6H12L10 4H4C2.9 4 2.01 4.9 2.01 6L2 18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V8C22 6.9 21.1 6 20 6ZM20 18H4V8H20V18Z" fill="currentColor"/>
                        </svg>
                      </div>
                      <span>Resources</span>
                      <div className="more-menu-arrow">→</div>
                    </button>

                    <div className="more-menu-divider"></div>

                    <div className="more-menu-social">
                      <div className="social-icon" aria-label="X" style={{ cursor: 'not-allowed', opacity: 0.6 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                      </div>
                      <div className="social-icon" aria-label="Discord" style={{ cursor: 'not-allowed', opacity: 0.6 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                        </svg>
                      </div>
                      <div className="social-icon" aria-label="Telegram" style={{ cursor: 'not-allowed', opacity: 0.6 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                        </svg>
                      </div>
                      <div className="social-icon" aria-label="GitHub" style={{ cursor: 'not-allowed', opacity: 0.6 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
                        </svg>
                      </div>
                    </div>

                    <div className="more-menu-footer">
                      <span style={{ cursor: 'not-allowed', opacity: 0.6 }}>Terms Of Business</span>
                      <span>•</span>
                      <span style={{ cursor: 'not-allowed', opacity: 0.6 }}>Privacy Policy</span>
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
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search address / username / move id"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchError(null);
                    if (!showSuggestions) setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 250)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                    if (e.key === "Escape") {
                      setShowSuggestions(false);
                      e.target.blur();
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
                      setSearchError(null);
                    }}
                    aria-label="Clear search"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12"/>
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
                      <div className="search-suggestion-header">Recent Searches</div>
                      {recentSearches.map((address, i) => (
                        <button
                          key={`recent-${address}-${i}`}
                          className="search-suggestion-item recent-search"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            goToWallet(address);
                          }}
                        >
                          <div className="suggestion-avatar recent">
                            <span className="suggestion-icon recent-icon">🕐</span>
                          </div>
                          <div className="suggestion-info">
                            <div className="suggestion-main">
                              <span className="suggestion-name">{formatAddress(address, 8, 6)}</span>
                              <span className="suggestion-badge recent">Recent</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                  {searchQuery.trim() && (
                    <>
                      {searchLoading && searchResults.length === 0 && (
                        <div className="search-suggestion-loading">
                          <div className="search-spinner-sm" />
                          <span>Searching blockchain...</span>
                        </div>
                      )}
                      {searchResults.length > 0 ? (
                        searchResults.map((result, i) => (
                          <button
                            key={`${result.type}-${result.address}-${i}`}
                            className="search-suggestion-item"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              goToWallet(result.address);
                            }}
                          >
                            <div className="suggestion-avatar">
                              <img src={result.pfp || '/pfp.PNG'} alt="" className="suggestion-pfp" />
                            </div>
                            <div className="suggestion-info">
                              <div className="suggestion-main">
                                <span className="suggestion-name">{result.username}</span>
                                <span className={`suggestion-badge ${result.type}`}>
                                  {result.type === 'blockchain' ? '✓ On-chain' 
                                    : result.type === 'profile' ? 'Profile' 
                                    : 'Address'}
                                </span>
                              </div>
                              <span className="suggestion-address">{formatAddress(result.address, 10, 6)}</span>
                            </div>
                          </button>
                        ))
                      ) : !searchLoading ? (
                        <div className="search-suggestion-empty">
                          {isValidAddress(searchQuery.trim()) ? (
                            <button
                              className="search-go-btn"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                goToWallet(searchQuery.trim());
                              }}
                            >
                              <span>🔍</span>
                              <span>Look up <strong>{formatAddress(searchQuery.trim())}</strong> on-chain</span>
                            </button>
                          ) : (
                            <span>No profiles found. Enter a valid 0x address to search the blockchain.</span>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>

          {connected && account ? (
            <div className="wallet-dropdown-container" ref={walletContainerRef}>
              <button 
                className="connect-btn connected" 
                onClick={handleWalletClick}
              >
                <span className="wallet-status-dot"></span>
                {formatAddress(account.address) || "Connected"}
              </button>

              {walletDropdownOpen && (
                <div className="wallet-dropdown" style={{ position: 'fixed', ...walletDropdownStyle }}>
                  <button 
                    className="wallet-menu-item"
                    onClick={() => {
                      navigate('/profile');
                      setWalletDropdownOpen(false);
                    }}
                  >
                    <div className="wallet-menu-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z" fill="currentColor"/>
                      </svg>
                    </div>
                    Profile
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
                        <path d="M10 17l1.41-1.41L8.83 13H20v-2H8.83l2.58-2.59L10 7l-5 5 5 5z" fill="currentColor"/>
                      </svg>
                    </div>
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="wallet-picker-container" ref={walletContainerRef}>
              <button className="connect-btn" onClick={handleConnect}>
                Connect Wallet
              </button>
              {walletPickerOpen && (
                <div className="wallet-picker" style={{ position: 'fixed', ...walletDropdownStyle }}>
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
                          className="wallet-option"
                          onClick={() => handleSelectWallet(wallet.name)}
                        >
                          {logo ? (
                            <img src={logo} alt={wallet.name} className="wallet-option-logo" />
                          ) : (
                            <span className="wallet-option-icon">🔗</span>
                          )}
                          {wallet.name}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </nav>

      {/* Page Content */}
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
