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
import './Settings.css';

export default function Settings() {
  const { account } = useWallet();
  const [currency, setCurrency] = useState('USD');
  const [theme, setTheme] = useState('dark');
  const [language, setLanguage] = useState('en');
  const [hidePositionThreshold, setHidePositionThreshold] = useState(DEFAULT_HIDE_POSITION_THRESHOLD);

  const accountSettingsKey = account?.address ? getSettingsStorageKey(account.address) : null;
  const settingsKey = accountSettingsKey || getSettingsStorageKey(null);

  const persistSettings = (overrides = {}) => {
    const settingsData = {
      currency,
      theme,
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
      const storedTheme = data.theme || getStoredThemePreference(settingsKey);
      setTheme(storedTheme);
      applyTheme(storedTheme);
      setLanguage(data.language || getStoredLanguagePreference(settingsKey));
      setHidePositionThreshold(getStoredHidePositionThreshold(settingsKey));
    } else {
      const storedTheme = getStoredThemePreference(settingsKey);
      setTheme(storedTheme);
      applyTheme(storedTheme);
      setLanguage(getStoredLanguagePreference(settingsKey));
      setHidePositionThreshold(getStoredHidePositionThreshold(settingsKey));
    }
  }, [settingsKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSave = () => {
    persistSettings();
    saveThemePreference(theme, settingsKey);
    saveLanguagePreference(language, settingsKey);
    applyTheme(theme);
    alert(t(language, 'settingsSaved'));
  };

  const handleThemeChange = (nextTheme) => {
    setTheme(nextTheme);
  };

  const handleLanguageChange = (nextLanguage) => {
    setLanguage(nextLanguage);
  };

  const handleReset = () => {
    if (confirm(t(language, 'settingsResetConfirm'))) {
      setCurrency('USD');
      setTheme('dark');
      setLanguage('en');
      setHidePositionThreshold(DEFAULT_HIDE_POSITION_THRESHOLD);
      localStorage.removeItem(settingsKey);
      saveThemePreference('dark', settingsKey);
      saveLanguagePreference('en', settingsKey);
    }
  };

  return (
    <div className="settings-page">
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

            <div className="setting-item">
              <div className="setting-info">
                <label>{t(language, 'hidePositions')}</label>
                <span className="setting-description">{t(language, 'hidePositionsDescription')}</span>
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
