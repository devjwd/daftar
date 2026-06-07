import { useState, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { getStoredLanguagePreference, saveLanguagePreference, t } from '../utils/language';
import { applyTheme, getStoredThemePreference, saveThemePreference } from '../utils/theme';
import {
  DEFAULT_HIDE_POSITION_THRESHOLD,
  formatHidePositionThresholdLabel,
  getSettingsStorageKey,
  getStoredHidePositionThreshold,
  HIDE_POSITION_THRESHOLD_OPTIONS,
  writeStoredSettings,
} from '../utils/settings';
import {
  getPlanStatus,
  getNonce,
  getAlertConfig,
  saveAlertConfig,
  linkDiscord,
  testAlerts,
  checkAlertLink,
  exchangeDiscordOauth,
  getTelegramLinkCode
} from '../services/api';
import { QRCodeSVG } from 'qrcode.react';
import './Settings.css';

export default function Settings() {
  const { account, signMessage } = useWallet();
  const walletAddress = account?.address ? account.address.toString() : '';
  const [currency, setCurrency] = useState('USD');
  const [theme, setTheme] = useState<any>('dark');
  const [language, setLanguage] = useState('en');
  const [uiLanguage, setUiLanguage] = useState('en'); // Language currently applied to UI labels
  const [hidePositionThreshold, setHidePositionThreshold] = useState(DEFAULT_HIDE_POSITION_THRESHOLD);

  const [isPro, setIsPro] = useState(false);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [alertConfig, setAlertConfig] = useState<any>({
    email: '',
    telegram_chat_id: '',
    discord_user_id: '',
    email_enabled: false,
    telegram_enabled: false,
    discord_enabled: false,
    min_amount_usd: 0,
    alert_on_received: true,
    alert_on_withdrawal: true,
    alert_on_swaps: false,
    alert_on_failed: false
  });

  const [telegramLinked, setTelegramLinked] = useState(false);
  const [discordLinked, setDiscordLinked] = useState(false);
  const [showTelegramModal, setShowTelegramModal] = useState(false);
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);

  const [discordLinkTarget, setDiscordLinkTarget] = useState<string | null>(null);
  // Stores a pending Discord OAuth code until wallet is connected
  const [pendingOauthCode, setPendingOauthCode] = useState<string | null>(null);

  // On first load: extract discord_user_id and OAuth code from URL
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const uid = queryParams.get('discord_user_id');
    if (uid) {
      setDiscordLinkTarget(uid);
    }

    const oauthCode = queryParams.get('code');
    if (oauthCode) {
      // Store it — will be processed once walletAddress is available
      setPendingOauthCode(oauthCode);
    }
  }, []); // Only on mount — we want to capture the URL before it's cleared

  // Process pending OAuth code when wallet becomes available
  useEffect(() => {
    if (pendingOauthCode && walletAddress && signMessage) {
      handleDiscordOauthCallback(pendingOauthCode);
      setPendingOauthCode(null);
    }
  }, [pendingOauthCode, walletAddress, signMessage]);

  // Check Pro status and load alerts configuration automatically
  useEffect(() => {
    if (walletAddress) {
      getPlanStatus(walletAddress).then(async (res) => {
        if (res && (res.tier === 'pro' || res.tier === 'lite')) {
          setIsPro(true);
          // Auto-load alerts configuration (unauthenticated - yields masked values)
          try {
            setLoadingAlerts(true);
            const data = await getAlertConfig(walletAddress);
            if (data) {
              setAlertConfig(data);
              setTelegramLinked(!!data.telegram_chat_id);
              setDiscordLinked(!!data.discord_user_id);
            }
          } catch (err) {
            console.error('Failed to auto-load alert configuration:', err);
          } finally {
            setLoadingAlerts(false);
          }
        } else {
          setIsPro(false);
        }
      });
    } else {
      setIsPro(false);
    }
  }, [walletAddress]);

  // Poll Telegram status while modal is open
  useEffect(() => {
    if (!showTelegramModal || !walletAddress) return;

    const interval = setInterval(async () => {
      try {
        const res = await checkAlertLink(walletAddress);
        if (res && res.telegramLinked) {
          setTelegramLinked(true);
          setAlertConfig((prev: any) => ({ ...prev, telegram_chat_id: 'Linked', telegram_enabled: true }));
          setShowTelegramModal(false);
          alert('Telegram Alerts linked successfully!');
        }
      } catch (err) {
        console.error('Error polling Telegram link status:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [showTelegramModal, walletAddress]);

  const handleLinkEmail = async () => {
    if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      alert('Please enter a valid email address.');
      return;
    }
    if (!walletAddress || !signMessage) return;
    setLoadingAlerts(true);
    try {
      const nonce = await getNonce(walletAddress);
      if (nonce === null) throw new Error("Could not retrieve security nonce.");

      const updatedConfig = {
        ...alertConfig,
        email: emailInput,
        email_enabled: true
      };

      const issuedAt = new Date().toISOString();
      const payloadMsg = JSON.stringify({
        action: 'save-alerts',
        address: walletAddress.toLowerCase(),
        issuedAt,
        nonce: String(nonce)
      });

      const response = await signMessage({
        address: true,
        application: true,
        chainId: true,
        message: payloadMsg,
        nonce: String(nonce)
      });

      const signature = Array.isArray(response.signature) ? response.signature[0] : response.signature;

      await saveAlertConfig(
        walletAddress,
        updatedConfig,
        {
          publicKey: account?.publicKey?.toString() || '',
          signature
        },
        response.fullMessage || payloadMsg,
        nonce
      );

      setAlertConfig(updatedConfig);
      alert('Email linked successfully!');
    } catch (err: any) {
      console.error(err);
      alert('Failed to link email: ' + err.message);
    } finally {
      setLoadingAlerts(false);
    }
  };

  const handleUnlinkEmail = async () => {
    if (!walletAddress || !signMessage) return;
    setLoadingAlerts(true);
    try {
      const nonce = await getNonce(walletAddress);
      if (nonce === null) throw new Error('Could not retrieve security nonce.');

      const issuedAt = new Date().toISOString();
      const payloadMsg = JSON.stringify({
        action: 'save-alerts',
        address: walletAddress.toLowerCase(),
        issuedAt,
        nonce: String(nonce)
      });

      const response = await signMessage({
        address: true,
        application: true,
        chainId: true,
        message: payloadMsg,
        nonce: String(nonce)
      });

      const signature = Array.isArray(response.signature) ? response.signature[0] : response.signature;

      const clearedConfig = { ...alertConfig, email: null, email_enabled: false };
      await saveAlertConfig(
        walletAddress,
        clearedConfig,
        { publicKey: account?.publicKey?.toString() || '', signature },
        response.fullMessage || payloadMsg,
        nonce
      );

      setEmailInput('');
      setAlertConfig(clearedConfig);
    } catch (err: any) {
      console.error(err);
      alert('Failed to unlink email: ' + err.message);
    } finally {
      setLoadingAlerts(false);
    }
  };

  const handleSaveAlerts = async () => {
    if (!walletAddress || !signMessage) return;
    try {
      const nonce = await getNonce(walletAddress);
      if (nonce === null) throw new Error("Could not retrieve security nonce.");

      const issuedAt = new Date().toISOString();
      const payloadMsg = JSON.stringify({
        action: 'save-alerts',
        address: walletAddress.toLowerCase(),
        issuedAt,
        nonce: String(nonce)
      });

      const response = await signMessage({
        address: true,
        application: true,
        chainId: true,
        message: payloadMsg,
        nonce: String(nonce)
      });

      const signature = Array.isArray(response.signature) ? response.signature[0] : response.signature;

      await saveAlertConfig(
        walletAddress,
        alertConfig,
        {
          publicKey: account?.publicKey?.toString() || '',
          signature
        },
        response.fullMessage || payloadMsg,
        nonce
      );

      alert('Alert settings saved successfully!');
    } catch (err: any) {
      console.error(err);
      alert('Failed to save alert settings: ' + err.message);
    }
  };

  const handleTestAlerts = async () => {
    if (!walletAddress || !signMessage) return;
    try {
      const nonce = await getNonce(walletAddress);
      if (nonce === null) throw new Error("Could not retrieve security nonce.");

      const issuedAt = new Date().toISOString();
      const payloadMsg = JSON.stringify({
        action: 'test-alerts',
        address: walletAddress.toLowerCase(),
        issuedAt,
        nonce: String(nonce)
      });

      const response = await signMessage({
        address: true,
        application: true,
        chainId: true,
        message: payloadMsg,
        nonce: String(nonce)
      });

      const signature = Array.isArray(response.signature) ? response.signature[0] : response.signature;

      const res = await testAlerts(
        walletAddress,
        {
          publicKey: account?.publicKey?.toString() || '',
          signature
        },
        response.fullMessage || payloadMsg,
        nonce
      );

      if (res && res.success) {
        alert(`Test alerts dispatched! Triggered channels: ${res.channelsTriggered.join(', ') || 'none'}`);
      }
    } catch (err: any) {
      console.error(err);
      alert('Failed to send test alerts: ' + err.message);
    }
  };

  const handleConnectTelegram = async () => {
    if (!walletAddress || !signMessage) {
      alert('Please connect your wallet first.');
      return;
    }
    setLoadingAlerts(true);
    try {
      const nonce = await getNonce(walletAddress);
      if (nonce === null) throw new Error("Could not retrieve security nonce.");

      const issuedAt = new Date().toISOString();
      const payloadMsg = JSON.stringify({
        action: 'link-telegram-code',
        address: walletAddress.toLowerCase(),
        issuedAt,
        nonce: String(nonce)
      });

      const response = await signMessage({
        address: true,
        application: true,
        chainId: true,
        message: payloadMsg,
        nonce: String(nonce)
      });

      const signature = Array.isArray(response.signature) ? response.signature[0] : response.signature;

      const res = await getTelegramLinkCode(
        walletAddress,
        {
          publicKey: account?.publicKey?.toString() || '',
          signature
        },
        response.fullMessage || payloadMsg,
        nonce
      );

      setTelegramLinkCode(res.code);
      setShowTelegramModal(true);
    } catch (err: any) {
      console.error(err);
      alert('Failed to initiate Telegram link: ' + err.message);
    } finally {
      setLoadingAlerts(false);
    }
  };

  const handleConfirmDiscordLink = async () => {
    if (!walletAddress || !signMessage) {
      alert('Please connect your wallet first.');
      return;
    }
    try {
      const nonce = await getNonce(walletAddress);
      if (nonce === null) throw new Error("Could not retrieve security nonce.");

      const issuedAt = new Date().toISOString();
      const payloadMsg = JSON.stringify({
        action: 'link-discord',
        address: walletAddress.toLowerCase(),
        discord_user_id: discordLinkTarget,
        issuedAt,
        nonce: String(nonce)
      });

      const response = await signMessage({
        address: true,
        application: true,
        chainId: true,
        message: payloadMsg,
        nonce: String(nonce)
      });

      const signature = Array.isArray(response.signature) ? response.signature[0] : response.signature;

      await linkDiscord(
        walletAddress,
        discordLinkTarget!,
        {
          publicKey: account?.publicKey?.toString() || '',
          signature
        },
        response.fullMessage || payloadMsg,
        nonce
      );

      alert('Discord account successfully linked!');
      setDiscordLinkTarget(null);
      
      setDiscordLinked(true);
      setAlertConfig((prev: any) => ({ ...prev, discord_user_id: discordLinkTarget, discord_enabled: true }));
    } catch (err: any) {
      console.error(err);
      alert('Failed to link Discord account: ' + err.message);
    }
  };

  const handleDiscordOauthCallback = async (code: string) => {
    if (!walletAddress || !signMessage) return;
    try {
      setLoadingAlerts(true);
      const nonce = await getNonce(walletAddress);
      if (nonce === null) throw new Error("Could not retrieve security nonce.");

      const issuedAt = new Date().toISOString();
      const payloadMsg = JSON.stringify({
        action: 'link-discord-oauth',
        address: walletAddress.toLowerCase(),
        code,
        issuedAt,
        nonce: String(nonce)
      });

      const response = await signMessage({
        address: true,
        application: true,
        chainId: true,
        message: payloadMsg,
        nonce: String(nonce)
      });

      const signature = Array.isArray(response.signature) ? response.signature[0] : response.signature;

      const redirectUri = window.location.origin + '/settings';
      const res = await exchangeDiscordOauth(
        walletAddress,
        code,
        redirectUri,
        {
          publicKey: account?.publicKey?.toString() || '',
          signature
        },
        response.fullMessage || payloadMsg,
        nonce
      );

      alert(`Discord account linked successfully via OAuth2! Connected username: ${res.username}`);
      
      // Clear code from URL
      window.history.replaceState({}, document.title, window.location.pathname);
      
      setDiscordLinked(true);
      setAlertConfig((prev: any) => ({ ...prev, discord_user_id: res.config.discord_user_id, discord_enabled: true }));
    } catch (err: any) {
      console.error(err);
      alert('Failed to connect Discord account: ' + err.message);
    } finally {
      setLoadingAlerts(false);
    }
  };

  const triggerDiscordOauth = () => {
    const clientId = '1500573624954781806';
    const redirectUri = encodeURIComponent(window.location.origin + '/settings');
    const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
    window.location.href = oauthUrl;
  };

  const accountSettingsKey = walletAddress ? getSettingsStorageKey(walletAddress) : null;
  const settingsKey = accountSettingsKey || getSettingsStorageKey(null);

  const persistSettings = (overrides = {}) => {
    const settingsData = {
      currency,
      theme: 'dark', // Locked to premium dark theme
      language,
      hidePositionThreshold,
      ...overrides,
    };

    writeStoredSettings(settingsKey, settingsData, Boolean(accountSettingsKey));
    return settingsData;
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Load settings from localStorage
    const saved = localStorage.getItem(settingsKey);
    if (saved) {
      const data = JSON.parse(saved);
      setCurrency(data.currency || 'USD');
      const storedTheme = data.theme || getStoredThemePreference();
      setTheme(storedTheme);
      applyTheme(storedTheme);

      const storedLang = data.language || getStoredLanguagePreference(settingsKey);
      setLanguage(storedLang);
      setUiLanguage(storedLang);

      setHidePositionThreshold(getStoredHidePositionThreshold(settingsKey));
    } else {
      const storedTheme = getStoredThemePreference();
      setTheme(storedTheme);
      applyTheme(storedTheme);

      const storedLang = getStoredLanguagePreference(settingsKey);
      setLanguage(storedLang);
      setUiLanguage(storedLang);

      setHidePositionThreshold(getStoredHidePositionThreshold(settingsKey));
    }
  }, [settingsKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSave = () => {
    persistSettings();
    saveThemePreference(theme);
    saveLanguagePreference(language, settingsKey);
    applyTheme(theme);
    setUiLanguage(language); // Only now apply the language to UI labels
    alert(t(language, 'settingsSaved'));
  };

  const handleThemeChange = (nextTheme) => {
    setTheme(nextTheme);
  };

  const handleLanguageChange = (nextLanguage) => {
    setLanguage(nextLanguage);
  };

  const handleReset = () => {
    if (confirm(t(uiLanguage, 'settingsResetConfirm'))) {
      setCurrency('USD');
      setTheme('dark');
      setLanguage('en');
      setUiLanguage('en');
      setHidePositionThreshold(DEFAULT_HIDE_POSITION_THRESHOLD);
      localStorage.removeItem(settingsKey);
      saveThemePreference('dark');
      saveLanguagePreference('en', settingsKey);
      applyTheme('dark');
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-container">
        <div className="settings-header">
          <h1>{t(uiLanguage, 'settingsTitle')}</h1>
          <p>{t(uiLanguage, 'settingsSubtitle')}</p>
        </div>

        <div className="settings-sections">
          {/* Display Settings */}
          <div className="settings-section">
            <h2 className="section-title">{t(uiLanguage, 'display')}</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>{t(uiLanguage, 'currency')}</label>
                <span className="setting-description">{t(uiLanguage, 'currencyDescription')}</span>
              </div>
              <select
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                }}
                className="setting-select"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="JPY">JPY (¥)</option>
                <option value="INR">INR (₹)</option>
                <option value="PKR">PKR (Rs)</option>
              </select>
            </div>

            {/* Theme selection removed - locked to premium dark-gold */}

            <div className="setting-item">
              <div className="setting-info">
                <label>{t(uiLanguage, 'language')}</label>
                <span className="setting-description">{t(uiLanguage, 'languageDescription')}</span>
              </div>
              <select
                value={language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="setting-select"
              >
                <option value="en">{t(uiLanguage, 'english')}</option>
                <option value="zh">{t(uiLanguage, 'chinese')}</option>
                <option value="ko">{t(uiLanguage, 'korean')}</option>
                <option value="tr">{t(uiLanguage, 'turkish')}</option>
              </select>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>{t(uiLanguage, 'hidePositions')}</label>
                <span className="setting-description">{t(uiLanguage, 'hidePositionsDescription')}</span>
              </div>
              <select
                value={hidePositionThreshold}
                onChange={(e) => {
                  const nextThreshold = Number(e.target.value);
                  setHidePositionThreshold(nextThreshold);
                }}
                className="setting-select"
              >
                {HIDE_POSITION_THRESHOLD_OPTIONS.map((threshold) => (
                  <option key={threshold} value={threshold}>
                    {formatHidePositionThresholdLabel(threshold)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Telegram QR Linking Modal */}
          {showTelegramModal && walletAddress && (
            <div className="alert-modal-overlay">
              <div className="alert-modal-container">
                <div className="alert-modal-header">
                  <h3>Scan to Link Telegram Alerts</h3>
                  <button onClick={() => setShowTelegramModal(false)} className="close-modal-btn">×</button>
                </div>
                <div className="alert-modal-content">
                  <p>Scan this QR code with your phone camera or click to link your wallet <code>{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</code> with the Telegram bot.</p>
                  
                  <div className="qr-wrapper">
                    <QRCodeSVG
                      value={`https://t.me/DaftarFi_bot?start=${telegramLinkCode || ''}`}
                      size={200}
                      level="H"
                      includeMargin={true}
                      className="qr-code-svg"
                    />
                  </div>

                  <a
                    href={`https://t.me/DaftarFi_bot?start=${telegramLinkCode || ''}`}
                    target="_blank"
                    rel="noreferrer"
                    className="qr-telegram-link"
                  >
                    Open in Telegram ↗
                  </a>
                  
                  <div className="polling-status">
                    <span className="spinner"></span>
                    <span>Waiting for Telegram activation...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Alerts Configuration Banner & Sections */}
          {discordLinkTarget && (
            <div className="discord-link-banner">
              <h3>Discord Link Request</h3>
              <p>Do you want to link your current wallet address with Discord User ID <code>{discordLinkTarget}</code>?</p>
              <div className="banner-actions">
                <button onClick={handleConfirmDiscordLink} className="confirm-btn">Confirm & Link</button>
                <button onClick={() => setDiscordLinkTarget(null)} className="cancel-btn">Cancel</button>
              </div>
            </div>
          )}

          {!walletAddress ? (
            <div className="settings-section alerts-locked">
              <h2 className="section-title">🚨 Real-time Alerts</h2>
              <div className="pro-lock-card">
                <p>Connect your wallet to configure alert settings.</p>
              </div>
            </div>
          ) : !isPro ? (
            <div className="settings-section alerts-locked">
              <h2 className="section-title">🚨 Real-time Alerts (Pro Feature)</h2>
              <div className="pro-lock-card">
                <div className="lock-icon">🔒</div>
                <p>Real-time notifications via Email, Telegram, and Discord are exclusive to <b>Pro/Premium</b> users.</p>
                <a href="/plans" className="upgrade-btn">Upgrade to Pro</a>
              </div>
            </div>
          ) : (
            <div className="settings-section alerts-active">
              <h2 className="section-title">🚨 Real-time Alerts</h2>
              
              {/* Email Alerts */}
              <div className="setting-item">
                <div className="setting-info">
                  <label>Email Alerts</label>
                  <span className="setting-description">Receive transaction updates in your inbox</span>
                </div>
                <div className="setting-controls">
                  {alertConfig.email ? (
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={alertConfig.email_enabled}
                        onChange={(e) => setAlertConfig({ ...alertConfig, email_enabled: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  ) : (
                    <div className="email-connect-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="email"
                        placeholder="Enter your email address"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="alert-input-text email-connect-input"
                        style={{ maxWidth: '240px' }}
                      />
                      <button onClick={handleLinkEmail} className="connect-channel-btn email" disabled={loadingAlerts}>
                        Link Email
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {alertConfig.email && (
                <div className="sub-setting-item status-info" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '400px' }}>
                  <span className="status-linked">Linked Email: <code>{alertConfig.email}</code></span>
                  <button onClick={handleUnlinkEmail} className="change-email-btn">Change Email</button>
                </div>
              )}

              {/* Telegram Alerts */}
              <div className="setting-item">
                <div className="setting-info">
                  <label>Telegram Alerts</label>
                  <span className="setting-description">Receive real-time notifications in Telegram</span>
                </div>
                <div className="setting-controls">
                  {telegramLinked ? (
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={alertConfig.telegram_enabled}
                        onChange={(e) => setAlertConfig({ ...alertConfig, telegram_enabled: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  ) : (
                    <button onClick={handleConnectTelegram} className="connect-channel-btn telegram" disabled={loadingAlerts}>
                      Connect Telegram
                    </button>
                  )}
                </div>
              </div>
              {telegramLinked && (
                <div className="sub-setting-item status-info">
                  <span className="status-linked">Linked Telegram Chat ID: <code>{alertConfig.telegram_chat_id}</code></span>
                </div>
              )}

              {/* Discord Alerts */}
              <div className="setting-item">
                <div className="setting-info">
                  <label>Discord Alerts</label>
                  <span className="setting-description">Receive DMs from our Discord Bot</span>
                </div>
                <div className="setting-controls">
                  {discordLinked ? (
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={alertConfig.discord_enabled}
                        onChange={(e) => setAlertConfig({ ...alertConfig, discord_enabled: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  ) : (
                    <button onClick={triggerDiscordOauth} className="connect-channel-btn discord" disabled={loadingAlerts}>
                      Connect Discord
                    </button>
                  )}
                </div>
              </div>
              {discordLinked && (
                <div className="sub-setting-item status-info">
                  <span className="status-linked">Linked Discord User ID: <code>{alertConfig.discord_user_id}</code></span>
                </div>
              )}

              {/* Alert Criteria Rules */}
              <div className="alert-rules-box">
                <h3 className="sub-section-title">Notification Rules</h3>
                
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Minimum Transaction Value ($ USD)</label>
                    <span className="setting-description">Only alert for transfers exceeding this amount</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={alertConfig.min_amount_usd}
                    onChange={(e) => setAlertConfig({ ...alertConfig, min_amount_usd: Math.max(0, Number(e.target.value)) })}
                    className="alert-input-number"
                  />
                </div>

                <div className="rule-checkboxes">
                  <label className="rule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={alertConfig.alert_on_received}
                      onChange={(e) => setAlertConfig({ ...alertConfig, alert_on_received: e.target.checked })}
                    />
                    <span>Alert on Incoming Funds (Received)</span>
                  </label>

                  <label className="rule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={alertConfig.alert_on_withdrawal}
                      onChange={(e) => setAlertConfig({ ...alertConfig, alert_on_withdrawal: e.target.checked })}
                    />
                    <span>Alert on Outgoing Funds (Withdrawal)</span>
                  </label>

                  <label className="rule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={alertConfig.alert_on_swaps}
                      onChange={(e) => setAlertConfig({ ...alertConfig, alert_on_swaps: e.target.checked })}
                    />
                    <span>Alert on Swap Actions</span>
                  </label>

                  <label className="rule-checkbox-label">
                    <input
                      type="checkbox"
                      checked={alertConfig.alert_on_failed}
                      onChange={(e) => setAlertConfig({ ...alertConfig, alert_on_failed: e.target.checked })}
                    />
                    <span>Alert on Failed Transactions</span>
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="alert-settings-actions">
                <button onClick={handleTestAlerts} className="test-alerts-btn">
                  🧪 Send Test Notification
                </button>
                <button onClick={handleSaveAlerts} className="save-alerts-btn">
                  💾 Save Alert Preferences
                </button>
              </div>
            </div>
          )}

        </div>

        <div className="settings-actions">
          <button onClick={handleReset} className="reset-btn">
            {t(uiLanguage, 'resetDefault')}
          </button>
          <button onClick={handleSave} className="save-btn">
            {t(uiLanguage, 'saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
}
