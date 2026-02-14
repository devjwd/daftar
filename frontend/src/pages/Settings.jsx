import { useState, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useNavigate } from 'react-router-dom';
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

  const settingsKey = account?.address
    ? `settings_${typeof account.address === 'string' ? account.address : account.address.toString()}`
    : null;

  useEffect(() => {
    // Load settings from localStorage
    if (settingsKey) {
      const saved = localStorage.getItem(settingsKey);
      if (saved) {
        const data = JSON.parse(saved);
        setCurrency(data.currency || 'USD');
        setNotifications(data.notifications ?? true);
        setPriceAlerts(data.priceAlerts ?? false);
        setTheme(data.theme || 'dark');
        setLanguage(data.language || 'en');
        setShowTestnet(data.showTestnet ?? false);
      }
    }
  }, [settingsKey]);

  const handleSave = () => {
    if (!settingsKey) return;
    const settingsData = {
      currency,
      notifications,
      priceAlerts,
      theme,
      language,
      showTestnet,
    };
    localStorage.setItem(settingsKey, JSON.stringify(settingsData));
    alert('Settings saved successfully!');
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all settings to default?')) {
      setCurrency('USD');
      setNotifications(true);
      setPriceAlerts(false);
      setTheme('dark');
      setLanguage('en');
      setShowTestnet(false);
      if (settingsKey) localStorage.removeItem(settingsKey);
    }
  };

  return (
    <div className="settings-page">
      <div className="page-nav">
        <button onClick={() => navigate('/')} className="back-btn">
          ← Back to Portfolio
        </button>
      </div>
      
      <div className="settings-container">
        <div className="settings-header">
          <h1>Settings</h1>
          <p>Customize your portfolio experience</p>
        </div>

        <div className="settings-sections">
          {/* Display Settings */}
          <div className="settings-section">
            <h2 className="section-title">Display</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>Currency</label>
                <span className="setting-description">Choose your preferred currency</span>
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
                <label>Theme</label>
                <span className="setting-description">Select your theme preference</span>
              </div>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="setting-select"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>Language</label>
                <span className="setting-description">Choose your language</span>
              </div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="setting-select"
              >
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="zh">中文</option>
              </select>
            </div>
          </div>

          {/* Notifications */}
          <div className="settings-section">
            <h2 className="section-title">Notifications</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>Enable Notifications</label>
                <span className="setting-description">Receive updates about your portfolio</span>
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
                <label>Price Alerts</label>
                <span className="setting-description">Get notified of significant price changes</span>
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
            <h2 className="section-title">Advanced</h2>
            <div className="setting-item">
              <div className="setting-info">
                <label>Show Testnet</label>
                <span className="setting-description">Include testnet tokens in portfolio</span>
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
            Reset to Default
          </button>
          <button onClick={handleSave} className="save-btn">
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
