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
  const [uiLanguage, setUiLanguage] = useState('en'); // Language currently applied to UI labels
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

      const storedLang = data.language || getStoredLanguagePreference(settingsKey);
      setLanguage(storedLang);
      setUiLanguage(storedLang);

      setHidePositionThreshold(getStoredHidePositionThreshold(settingsKey));
    } else {
      const storedTheme = getStoredThemePreference(settingsKey);
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
    saveThemePreference(theme, settingsKey);
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
      saveThemePreference('dark', settingsKey);
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

            <div className="setting-item">
              <div className="setting-info">
                <label>{t(uiLanguage, 'theme')}</label>
                <span className="setting-description">{t(uiLanguage, 'themeDescription')}</span>
              </div>
              <select
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value)}
                className="setting-select"
              >
                <option value="dark">{t(uiLanguage, 'dark')}</option>
                <option value="light">{t(uiLanguage, 'light')}</option>
                <option value="auto">{t(uiLanguage, 'auto')}</option>
              </select>
            </div>

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
