import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { WalletModal } from '../components/WalletModal';
import { isValidAddress, formatAddress } from '../utils/tokenUtils';
import { getStoredLanguagePreference, t } from '../utils/language';
import { SearchBar } from '../components/SearchBar';
import { getTransactionByHash } from '../services/transactionService';
import TransactionVisualizer from '../components/Transactions/TransactionVisualizer';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const { connected, account } = useWallet();
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

  // Navigate to portfolio when wallet connects
  useEffect(() => {
    if (connected && account) {
      navigate(`/wallet/${account.address}`);
    }
  }, [connected, account, navigate]);


  const [selectedTxForPlayback, setSelectedTxForPlayback] = useState<any | null>(null);




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
            <SearchBar variant="home" language={language} />

            <div className="home-divider">
              <span className="home-divider-text">{t(language, 'homeConnectWalletPrompt')}</span>
            </div>

            <div className="home-wallet-section">
              <button
                className="home-connect-btn"
                type="button"
                onClick={() => setShowWalletPicker(true)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="18" height="14" rx="2" />
                  <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <circle cx="16" cy="14" r="1" fill="currentColor" />
                </svg>
                <span>{t(language, 'connectWallet')}</span>
              </button>
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

      <WalletModal isOpen={showWalletPicker} onClose={() => setShowWalletPicker(false)} />

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
