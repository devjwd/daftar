import React, { useEffect, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { getStoredLanguagePreference, t } from '../utils/language';
import './WalletModal.css';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  const { connect, wallets, connected } = useWallet();
  const [language, setLanguage] = useState(() => getStoredLanguagePreference());
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleLanguageChange = (e: Event) => {
      const nextLanguage = (e as CustomEvent)?.detail?.language;
      if (nextLanguage) {
        setLanguage(nextLanguage);
      }
    };
    window.addEventListener('languagechange', handleLanguageChange);
    return () => window.removeEventListener('languagechange', handleLanguageChange);
  }, []);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Close modal when wallet successfully connects
  useEffect(() => {
    if (connected && isOpen) {
      onClose();
    }
  }, [connected, isOpen, onClose]);

  // Reset states on open/close
  useEffect(() => {
    if (isOpen) {
      setConnectingWallet(null);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getWalletLogo = (name: string) => {
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

  const handleConnect = async (walletName: any) => {
    setConnectingWallet(walletName);
    setError(null);
    try {
      await connect(walletName);
    } catch (err: any) {
      console.error('Wallet connect failed', err);
      setError(err?.message || 'Failed to connect wallet. Please try again.');
      setConnectingWallet(null);
    }
  };

  const renderTermsNotice = () => {
    switch (language) {
      case 'zh':
        return (
          <>
            连接钱包即表示您同意我们的
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="terms-link">服务条款</a>
            和
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="terms-link">隐私政策</a>。
          </>
        );
      case 'ko':
        return (
          <>
            지갑을 연결하면
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="terms-link">서비스 약관</a>
            및
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="terms-link">개인정보 처리방침</a>
            에 동의하게 됩니다.
          </>
        );
      case 'tr':
        return (
          <>
            Bir cüzdan bağlayarak
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="terms-link">Hizmet Şartlarımızı</a>
            ve
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="terms-link">Gizlilik Politikamızı</a>
            kabul etmiş olursunuz.
          </>
        );
      default:
        return (
          <>
            By continuing, you agree to the
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="terms-link">Terms of Service</a>
          </>
        );
    }
  };

  // Filter out social logins (Google, Apple, etc.) if they exist in wallets list
  const filteredWallets = (wallets || []).filter(
    (w) => !w.name.includes('Google') && !w.name.includes('Apple')
  );

  return (
    <div className="wallet-conn-modal-overlay" onClick={onClose}>
      <div className="wallet-conn-modal-container" onClick={(e) => e.stopPropagation()}>
        <button
          className="wallet-conn-modal-close-btn"
          onClick={onClose}
          aria-label="Close modal"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="wallet-conn-modal-header">
          <h2 className="wallet-conn-modal-title">{t(language, 'connectWallet')}</h2>
          <p className="wallet-conn-modal-subtitle">
            {language === 'zh' ? '选择一个钱包以连接至 Movement 网络'
              : language === 'ko' ? 'Movement 네트워크에 연결할 지갑을 선택하세요'
                : language === 'tr' ? 'Movement ağına bağlanmak için bir cüzdan seçin'
                  : 'Select a wallet to connect to the Movement network'}
          </p>
        </div>

        {error && <div className="wallet-conn-modal-error">{error}</div>}

        <div className="wallet-conn-modal-options-list">
          {filteredWallets.length === 0 ? (
            <div className="wallet-conn-modal-empty">
              {language === 'zh' ? '未检测到支持的钱包。'
                : language === 'ko' ? '지원되는 지갑을 찾을 수 없습니다.'
                  : language === 'tr' ? 'Desteklenen cüzdan bulunamadı.'
                    : 'No supported wallets found.'}
            </div>
          ) : (
            filteredWallets.map((walletOption) => {
              const logo = getWalletLogo(walletOption.name) || walletOption.icon;
              const isInstalled = walletOption.readyState === 'Installed';
              const isConnecting = connectingWallet === walletOption.name;

              return (
                <button
                  key={walletOption.name}
                  className={`wallet-conn-modal-option-btn ${isConnecting ? 'connecting' : ''}`}
                  onClick={() => handleConnect(walletOption.name)}
                  disabled={!!connectingWallet}
                >
                  <div className="wallet-conn-modal-option-left">
                    <div className="wallet-conn-modal-logo-wrapper">
                      {logo ? (
                        <img src={logo} alt={`${walletOption.name} logo`} className="wallet-conn-modal-logo" />
                      ) : (
                        <div className="wallet-conn-modal-logo-fallback">
                          {walletOption.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <span className="wallet-conn-modal-name">{walletOption.name}</span>
                  </div>

                  <div className="wallet-conn-modal-option-right">
                    {isConnecting ? (
                      <span className="wallet-conn-modal-connecting-spinner" />
                    ) : isInstalled ? (
                      <span className="wallet-conn-modal-badge installed">Installed</span>
                    ) : (
                      <span className="wallet-conn-modal-badge detect">Popular</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="wallet-conn-modal-footer">
          <div className="wallet-conn-modal-terms-notice">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="terms-icon-svg">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <p className="wallet-conn-modal-terms-text">{renderTermsNotice()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
