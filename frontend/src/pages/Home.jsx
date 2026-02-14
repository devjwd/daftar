import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { formatAddress, isValidAddress } from '../utils/tokenUtils';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const { connected, account, connect, wallets } = useWallet();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [showWalletPicker, setShowWalletPicker] = useState(false);

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

  const handleSearch = (e) => {
    e.preventDefault();
    const query = searchQuery.trim();
    
    if (!query) {
      setSearchError('Please enter a wallet address');
      return;
    }
    
    if (!isValidAddress(query)) {
      setSearchError('Invalid wallet address format');
      return;
    }
    
    navigate(`/wallet/${query}`);
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
              Your Complete
              <span className="title-gradient"> DeFi Portfolio</span>
            </h1>
            
            <p className="home-subtitle">
              Track, analyze, and manage your Movement Network assets in real time.
              Monitor DeFi positions, token balances, and earn social reputation all in one place.
            </p>

            <div className="home-stats">
              <div className="stat-item">
                <div className="stat-value">10+</div>
                <div className="stat-label">Protocols Supported</div>
              </div>
              <div className="stat-divider"></div>
              <div className="stat-item">
                <div className="stat-value">Real-time</div>
                <div className="stat-label">On-chain Data</div>
              </div>
              <div className="stat-divider"></div>
              <div className="stat-item">
                <div className="stat-value">24/7</div>
                <div className="stat-label">Portfolio Tracking</div>
              </div>
            </div>
          </div>

          {/* Action Section */}
          <div className="home-action-section">
            <form onSubmit={handleSearch} className="home-search-form">
              <div className={`home-search-wrapper ${searchError ? 'error' : ''}`}>
                <svg className="home-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  type="text"
                  placeholder="Enter movement wallet address or username..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchError('');
                  }}
                  className="home-search-input"
                />
                <button type="submit" className="home-search-btn">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </button>
              </div>
              {searchError && (
                <p className="home-search-error">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {searchError}
                </p>
              )}
            </form>

            <div className="home-divider">
              <span className="home-divider-text">or connect your wallet</span>
            </div>

            <div className="home-wallet-section">
              <button 
                className="home-connect-btn"
                onClick={() => setShowWalletPicker(!showWalletPicker)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="18" height="14" rx="2"/>
                  <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <circle cx="16" cy="14" r="1" fill="currentColor"/>
                </svg>
                <span>Connect Wallet</span>
              </button>

              {showWalletPicker && (
                <div className="home-wallet-picker">
                  <div className="wallet-picker-header">
                    <h4>Choose Wallet</h4>
                    <button className="wallet-close" onClick={() => setShowWalletPicker(false)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
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
                            onClick={() => handleConnectWallet(wallet.name)}
                          >
                            <div className="wallet-option-content">
                              {logo ? (
                                <img src={logo} alt={wallet.name} className="wallet-option-logo" />
                              ) : (
                                <div className="wallet-option-placeholder">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="7" width="18" height="14" rx="2"/>
                                    <circle cx="16" cy="14" r="1" fill="currentColor"/>
                                  </svg>
                                </div>
                              )}
                              <span>{wallet.name}</span>
                            </div>
                            <svg className="wallet-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6"/>
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
                  <line x1="12" y1="20" x2="12" y2="10"/>
                  <line x1="18" y1="20" x2="18" y2="4"/>
                  <line x1="6" y1="20" x2="6" y2="16"/>
                </svg>
              </div>
              <h3>Portfolio Analytics</h3>
              <p>Track your complete portfolio with real time balance updates and historical performance charts</p>
            </div>
            
            <div className="home-feature">
              <div className="home-feature-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                  <polyline points="2 17 12 22 22 17"/>
                  <polyline points="2 12 12 17 22 12"/>
                </svg>
              </div>
              <h3>DeFi Positions</h3>
              <p>Monitor lending, staking, and liquidity positions across all Movement protocols</p>
            </div>
            
            <div className="home-feature">
              <div className="home-feature-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                  <polyline points="17 6 23 6 23 12"/>
                </svg>
              </div>
              <h3>Live Prices</h3>
              <p>Get accurate token pricing with automatic USD conversion and market data</p>
            </div>
            
            <div className="home-feature">
              <div className="home-feature-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v6m0 6v6m5.2-13.2l-4.2 4.2m0 6l4.2 4.2M1 12h6m6 0h6m-13.2 5.2l4.2-4.2m0-6l-4.2-4.2"/>
                </svg>
              </div>
              <h3>Token Swaps</h3>
              <p>Seamlessly swap tokens within the app with competitive rates and low fees</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Section */}
      <div className="home-footer">
        <div className="footer-content">
          <p className="footer-text">Built with love for the Movement Network ecosystem</p>
        </div>
      </div>
    </div>
  );
}
