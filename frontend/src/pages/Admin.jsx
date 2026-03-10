import React, { useMemo, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import './Admin.css';
import BadgeAdmin from '../components/BadgeAdmin';
import {
  getSwapSettings,
  updateSwapSettings,
} from '../services/adminService';

export default function Admin() {
  const { connected } = useWallet();
  const [activeTab, setActiveTab] = useState('badges');
  const [swapSettings, setSwapSettings] = useState(getSwapSettings());
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const FEE_PRESETS_BPS = [0, 10, 25, 50];
  const SLIPPAGE_PRESETS = [0.1, 0.5, 1, 3];

  const feeInBps = useMemo(() => Number(swapSettings.feeInBps) || 0, [swapSettings.feeInBps]);
  const slippagePercent = useMemo(
    () => Number(swapSettings.defaultSlippagePercent) || 0.5,
    [swapSettings.defaultSlippagePercent]
  );

  const feePercent = useMemo(() => (feeInBps / 100).toFixed(2), [feeInBps]);

  const showMessage = (message, isError = false) => {
    if (isError) {
      setErrorMessage(message);
      setSuccessMessage('');
    } else {
      setSuccessMessage(message);
      setErrorMessage('');
    }

    setTimeout(() => {
      setErrorMessage('');
      setSuccessMessage('');
    }, 3000);
  };


  const handleSaveSettings = () => {
    try {
      const next = updateSwapSettings({
        feeInBps: Math.max(0, Math.min(500, Number(swapSettings.feeInBps) || 0)),
        feeReceiver: swapSettings.feeReceiver || '',
        isFeeIn: Boolean(swapSettings.isFeeIn),
        defaultSlippagePercent: Math.max(0.01, Math.min(50, Number(swapSettings.defaultSlippagePercent) || 0.5)),
        mosaicApiKey: swapSettings.mosaicApiKey || '',
        routingMode: 'mosaic',
      });
      setSwapSettings(next);
      showMessage('Settings saved');
    } catch (error) {
      showMessage(error.message || 'Failed to save settings', true);
    }
  };
  const resetSwapSettings = () => {
    setSwapSettings(getSwapSettings());
    showMessage('Swap settings reset to saved values');
  };

  return (
    <div className="admin-page">
      <div className="admin-container">
        <div className="admin-header">
          <h1>Admin Panel</h1>
          {!connected && <p className="admin-warning">Connect wallet for on-chain actions in badge management.</p>}
        </div>

        {errorMessage && <div className="admin-message error">{errorMessage}</div>}
        {successMessage && <div className="admin-message success">{successMessage}</div>}

        <div className="admin-tabs-shell">
          <div className="admin-tabs" role="tablist" aria-label="Admin sections">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'badges'}
              className={`admin-tab ${activeTab === 'badges' ? 'active' : ''}`}
              onClick={() => setActiveTab('badges')}
            >
              <span className="admin-tab-icon" aria-hidden="true">🏅</span>
              <span className="admin-tab-text">
                <span className="admin-tab-title">Badges</span>
                <span className="admin-tab-meta">SBT campaigns and rewards</span>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'settings'}
              className={`admin-tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <span className="admin-tab-icon" aria-hidden="true">⚙️</span>
              <span className="admin-tab-text">
                <span className="admin-tab-title">Settings</span>
                <span className="admin-tab-meta">Swap execution controls</span>
              </span>
            </button>
          </div>
        </div>

        {activeTab === 'badges' && <BadgeAdmin />}

        {activeTab === 'settings' && (
          <div className="admin-content">
            <div className="admin-settings-section">
              <h2>Mosaic Swap Settings</h2>
              <p className="section-description">
                Configure default execution behavior for all swaps. Routing is fixed to Mosaic.
              </p>

              <div className="admin-settings-layout">
                <div className="admin-settings-main">
                  <div className="admin-settings-card">
                    <h3>Execution</h3>
                    <div className="admin-form-group">
                      <label>Default Slippage (%)</label>
                      <input
                        type="number"
                        min="0.01"
                        max="50"
                        step="0.01"
                        value={swapSettings.defaultSlippagePercent}
                        onChange={(e) => setSwapSettings((prev) => ({ ...prev, defaultSlippagePercent: e.target.value }))}
                      />
                      <small className="admin-field-hint">
                        Applied on the swap screen as the starting value.
                      </small>
                    </div>
                    <div className="admin-chip-row">
                      {SLIPPAGE_PRESETS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`admin-chip ${Math.abs(slippagePercent - value) < 0.001 ? 'active' : ''}`}
                          onClick={() => setSwapSettings((prev) => ({ ...prev, defaultSlippagePercent: value }))}
                        >
                          {value}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="admin-settings-card">
                    <h3>Protocol Fee</h3>
                    <div className="admin-form-group">
                      <label>Fee (bps)</label>
                      <input
                        type="number"
                        min="0"
                        max="500"
                        step="1"
                        value={swapSettings.feeInBps}
                        onChange={(e) => setSwapSettings((prev) => ({ ...prev, feeInBps: e.target.value }))}
                      />
                      <small className="admin-field-hint">
                        Current: {feePercent}% (max 5.00%)
                      </small>
                    </div>
                    <div className="admin-chip-row">
                      {FEE_PRESETS_BPS.map((bps) => (
                        <button
                          key={bps}
                          type="button"
                          className={`admin-chip ${feeInBps === bps ? 'active' : ''}`}
                          onClick={() => setSwapSettings((prev) => ({ ...prev, feeInBps: bps }))}
                        >
                          {bps} bps
                        </button>
                      ))}
                    </div>

                    <div className="admin-form-group">
                      <label>Fee Receiver</label>
                      <input
                        type="text"
                        value={swapSettings.feeReceiver}
                        onChange={(e) => setSwapSettings((prev) => ({ ...prev, feeReceiver: e.target.value }))}
                        placeholder="0x..."
                      />
                    </div>

                    <label className="admin-checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(swapSettings.isFeeIn)}
                        onChange={(e) => setSwapSettings((prev) => ({ ...prev, isFeeIn: e.target.checked }))}
                      />
                      Deduct protocol fee from input token
                    </label>
                  </div>
                </div>

                <aside className="admin-settings-sidebar">
                  <div className="admin-settings-card">
                    <h3>Mosaic Access</h3>
                    <div className="admin-form-group">
                      <label>Mosaic API Key</label>
                      <div className="admin-inline-input">
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={swapSettings.mosaicApiKey || ''}
                          onChange={(e) => setSwapSettings((prev) => ({ ...prev, mosaicApiKey: e.target.value }))}
                          placeholder="Enter API key"
                        />
                        <button
                          type="button"
                          className="admin-btn admin-btn-secondary admin-btn-small"
                          onClick={() => setShowApiKey((prev) => !prev)}
                        >
                          {showApiKey ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <small className="admin-field-hint">
                        Used for Mosaic quote requests. Leave empty to use public access.
                      </small>
                    </div>
                  </div>

                  <div className="admin-summary-card">
                    <h4>Current Setup</h4>
                    <div className="admin-summary-item">
                      <span>Routing</span>
                      <strong>Mosaic Only</strong>
                    </div>
                    <div className="admin-summary-item">
                      <span>Default Slippage</span>
                      <strong>{slippagePercent}%</strong>
                    </div>
                    <div className="admin-summary-item">
                      <span>Protocol Fee</span>
                      <strong>{feePercent}%</strong>
                    </div>
                    <div className="admin-summary-item">
                      <span>Fee Receiver</span>
                      <strong>{swapSettings.feeReceiver ? 'Configured' : 'Not set'}</strong>
                    </div>
                    <div className="admin-summary-item">
                      <span>API Key</span>
                      <strong>{swapSettings.mosaicApiKey ? 'Configured' : 'Not set'}</strong>
                    </div>
                  </div>

                  <div className="admin-routing-pill">
                    Routing Mode: <strong>Mosaic Only</strong>
                  </div>
                </aside>
              </div>

              <div className="admin-form-actions">
                <button className="admin-btn admin-btn-primary" onClick={handleSaveSettings}>
                  Save Swap Settings
                </button>
                <button className="admin-btn admin-btn-secondary" onClick={resetSwapSettings}>
                  Reset Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
