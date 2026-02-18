import { useState, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useNavigate } from 'react-router-dom';
import { getStoredLanguagePreference, saveLanguagePreference, t } from '../utils/language';
import { applyTheme, getStoredThemePreference, saveThemePreference } from '../utils/theme';
import './Settings.css';

export default function Settings() {
  const { account } = useWallet();
  const navigate = useNavigate();
  const [currency, setCurrency] = useState('USD');
  const [notifications, setNotifications] = useState(true);
  const [priceAlerts, setPriceAlerts] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [language, setLanguage] = useState('en');
  const [showTestnet, setShowTestnet] = useState(false);

  const accountSettingsKey = account?.address
    ? `settings_${typeof account.address === 'string' ? account.address : account.address.toString()}`
    : null;
  const settingsKey = accountSettingsKey || 'settings_global';

  const persistSettings = (overrides = {}) => {
    const settingsData = {
      currency,
      notifications,
      priceAlerts,
      theme,
      language,
      showTestnet,
      ...overrides,
    };

    localStorage.setItem(settingsKey, JSON.stringify(settingsData));
    if (accountSettingsKey) {
      localStorage.setItem('settings_global', JSON.stringify(settingsData));
    }

    return settingsData;
  };

  useEffect(() => {
    // Load settings from localStorage
    const saved = localStorage.getItem(settingsKey);
    if (saved) {
      const data = JSON.parse(saved);
      setCurrency(data.currency || 'USD');
      setNotifications(data.notifications ?? true);
      setPriceAlerts(data.priceAlerts ?? false);
      const storedTheme = data.theme || getStoredThemePreference(settingsKey);
      setTheme(storedTheme);
      applyTheme(storedTheme);
      setLanguage(data.language || getStoredLanguagePreference(settingsKey));
      setShowTestnet(data.showTestnet ?? false);
    } else {
      const storedTheme = getStoredThemePreference(settingsKey);
      setTheme(storedTheme);
      applyTheme(storedTheme);
      setLanguage(getStoredLanguagePreference(settingsKey));
    }
  }, [settingsKey]);

  const handleSave = () => {
    persistSettings();
    saveThemePreference(theme, settingsKey);
    saveLanguagePreference(language, settingsKey);
    alert('Settings saved successfully!');
  };

  const handleThemeChange = (nextTheme) => {
    setTheme(nextTheme);
    persistSettings({ theme: nextTheme });
    saveThemePreference(nextTheme, settingsKey);
  };

  const handleLanguageChange = (nextLanguage) => {
    setLanguage(nextLanguage);
    persistSettings({ language: nextLanguage });
    saveLanguagePreference(nextLanguage, settingsKey);
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all settings to default?')) {
      setCurrency('USD');
      setNotifications(true);
      setPriceAlerts(false);
      setTheme('dark');
      setLanguage('en');
      setShowTestnet(false);
      localStorage.removeItem(settingsKey);
      saveThemePreference('dark', settingsKey);
      saveLanguagePreference('en', settingsKey);
    }
  };

  return (
    <div className="settings-page">
      <div className="page-nav">
        <button onClick={() => navigate('/')} className="back-btn">
          ← {t(language, 'backToPortfolio')}
        </button>
      </div>
      
      <div className="settings-container">
        <div className="settings-header">
          <h1>{t(language, 'settingsTitle')}</h1>
          <p>{t(language, 'settingsSubtitle')}</p>
        </div>

        <div className="settings-sections">
          {/* Display Settings */}
          <div className="settings-section">
            <h2 className="section-title">{t(language, 'display')}</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>{t(language, 'currency')}</label>
                <span className="setting-description">{t(language, 'currencyDescription')}</span>
              </div>
              <select
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  // Save immediately on change
                  const settingsData = {
                    currency: e.target.value,
                    notifications,
                    priceAlerts,
                    theme,
                    language,
                    showTestnet,
                  };
                  if (settingsKey) {
                    localStorage.setItem(settingsKey, JSON.stringify(settingsData));
                    // Also save to global settings for non-connected users
                    localStorage.setItem('settings_global', JSON.stringify(settingsData));
                  }
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

            <div className="setting-item">
              <div className="setting-info">
                <label>{t(language, 'theme')}</label>
                <span className="setting-description">{t(language, 'themeDescription')}</span>
              </div>
              <select
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value)}
                className="setting-select"
              >
                <option value="dark">{t(language, 'dark')}</option>
                <option value="light">{t(language, 'light')}</option>
                <option value="auto">{t(language, 'auto')}</option>
              </select>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>{t(language, 'language')}</label>
                <span className="setting-description">{t(language, 'languageDescription')}</span>
              </div>
              <select
                value={language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="setting-select"
              >
                <option value="en">{t(language, 'english')}</option>
                <option value="zh">{t(language, 'chinese')}</option>
                <option value="ko">{t(language, 'korean')}</option>
                <option value="tr">{t(language, 'turkish')}</option>
              </select>
            </div>
          </div>

          {/* Notifications */}
          <div className="settings-section">
            <h2 className="section-title">{t(language, 'notifications')}</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>{t(language, 'enableNotifications')}</label>
                <span className="setting-description">{t(language, 'enableNotificationsDescription')}</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={notifications}
                  onChange={(e) => setNotifications(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>{t(language, 'priceAlerts')}</label>
                <span className="setting-description">{t(language, 'priceAlertsDescription')}</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={priceAlerts}
                  onChange={(e) => setPriceAlerts(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>

          {/* Advanced */}
          <div className="settings-section">
            <h2 className="section-title">{t(language, 'advanced')}</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>{t(language, 'showTestnet')}</label>
                <span className="setting-description">{t(language, 'showTestnetDescription')}</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={showTestnet}
                  onChange={(e) => setShowTestnet(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <button onClick={handleReset} className="reset-btn">
            {t(language, 'resetDefault')}
          </button>
          <button onClick={handleSave} className="save-btn">
            {t(language, 'saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
}
