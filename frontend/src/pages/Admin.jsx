import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import './Admin.css';
import BadgeAdmin from '../components/BadgeAdmin';
import EntityAdmin from '../components/EntityAdmin';
import { useMovementClient } from '../hooks/useMovementClient';
import { useTransactionTracker } from '../hooks/useTransactionTracker';
import {
  getSwapSettings,
  updateSwapSettings,
} from '../services/adminService';

import { ADMIN_ADDRESS } from '../config/network';
import {
  fetchRouterPartnerConfig,
  isRouterConfigured,
  setRouterPaused,
  updateRouterChargeFeeBy,
  updateRouterDefaultSlippage,
  updateRouterFee,
  updateRouterTreasury,
} from '../services/routerService';
import { fetchRegistryInfo } from '../services/badgeService';

export default function Admin() {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const { client: movementClient } = useMovementClient();
  const { pendingTx, trackTransaction } = useTransactionTracker();
  
  const [activeTab, setActiveTab] = useState('badges');

  const [swapSettings, setSwapSettings] = useState(getSwapSettings());
  const [onChainSettings, setOnChainSettings] = useState(null);
  const [routerLoading, setRouterLoading] = useState(false);
  const [routerSaving, setRouterSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [onChainAdmin, setOnChainAdmin] = useState(null);

  const connectedAddress = useMemo(() => {
    if (!account?.address) return null;
    return String(account.address).toLowerCase();
  }, [account?.address]);

  const isAdmin = useMemo(() => {
    if (!connected || !connectedAddress) return false;
    const authorized = [
      ADMIN_ADDRESS.toLowerCase(),
      onChainAdmin?.toLowerCase()
    ].filter(Boolean);
    return authorized.includes(connectedAddress);
  }, [connected, connectedAddress, onChainAdmin]);

  const FEE_PRESETS_BPS = [0, 10, 25, 50];
  const SLIPPAGE_PRESETS = [0.1, 0.5, 1, 3];
  const ADDRESS_RE = /^0x[a-fA-F0-9]{1,64}$/;

  const feeInBps = useMemo(() => Number(swapSettings.feeInBps) || 0, [swapSettings.feeInBps]);
  const slippagePercent = useMemo(
    () => Number(swapSettings.defaultSlippagePercent) || 0.5,
    [swapSettings.defaultSlippagePercent]
  );

  const feePercent = useMemo(() => (feeInBps / 100).toFixed(2), [feeInBps]);

  const showMessage = useCallback((message, isError = false) => {
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
  }, []);

  const loadRouterSettings = useCallback(async () => {
    if (!movementClient || !isRouterConfigured()) return;

    setRouterLoading(true);
    try {
      const chain = await fetchRouterPartnerConfig(movementClient);
      setOnChainSettings(chain);

      const local = getSwapSettings();
      setSwapSettings((prev) => ({
        ...prev,
        ...chain,
        mosaicApiKey: local.mosaicApiKey || prev.mosaicApiKey || '',
      }));
    } catch (error) {
      showMessage(error?.message || 'Failed to load on-chain router settings', true);
    } finally {
      setRouterLoading(false);
    }
  }, [movementClient, showMessage]);

  useEffect(() => {
    const loadGlobalConfig = async () => {
      if (!movementClient) return;
      try {
        const registry = await fetchRegistryInfo(movementClient);
        if (registry?.admin) setOnChainAdmin(registry.admin);
      } catch (err) {
        console.warn('[Admin] Failed to load registry admin:', err);
      }
    };
    loadGlobalConfig();

    if (activeTab !== 'settings') return;
    void loadRouterSettings();
  }, [activeTab, loadRouterSettings, movementClient]);

  const [pendingChanges, setPendingChanges] = useState([]);

  const handleSaveSettings = useCallback(async () => {
    try {
      if (!connected || !account || !signAndSubmitTransaction) {
        throw new Error('Connect admin wallet to submit router updates');
      }

      const normalizeAddress = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        return raw.startsWith('0x') ? raw : `0x${raw}`;
      };

      const normalized = {
        feeInBps: Math.max(0, Math.min(500, Number(swapSettings.feeInBps) || 0)),
        feeReceiver: normalizeAddress(swapSettings.feeReceiver),
        chargeFeeBy: String(swapSettings.chargeFeeBy || 'token_in').toLowerCase() === 'token_out' ? 'token_out' : 'token_in',
        defaultSlippagePercent: Math.max(0.01, Math.min(50, Number(swapSettings.defaultSlippagePercent) || 0.5)),
        paused: Boolean(swapSettings.paused),
      };

      if (normalized.feeReceiver && !ADDRESS_RE.test(normalized.feeReceiver)) {
        throw new Error('Fee receiver must be a valid 0x address');
      }

      const before = onChainSettings || (await fetchRouterPartnerConfig(movementClient));
      const changes = [];

      if (normalized.feeInBps !== Number(before.feeInBps || 0)) {
        changes.push({
          id: 'fee',
          label: 'Fee (bps)',
          from: before.feeInBps,
          to: normalized.feeInBps,
          action: () => updateRouterFee({ signAndSubmitTransaction, sender: account.address.toString(), feeInBps: normalized.feeInBps })
        });
      }

      if (normalized.feeReceiver.toLowerCase() !== String(before.feeReceiver || '').toLowerCase()) {
        changes.push({
          id: 'treasury',
          label: 'Treasury Wallet',
          from: before.feeReceiver,
          to: normalized.feeReceiver,
          action: () => updateRouterTreasury({ signAndSubmitTransaction, sender: account.address.toString(), feeReceiver: normalized.feeReceiver })
        });
      }

      if (normalized.chargeFeeBy !== String(before.chargeFeeBy || 'token_in').toLowerCase()) {
        changes.push({
          id: 'charge_by',
          label: 'Charge Fee By',
          from: before.chargeFeeBy,
          to: normalized.chargeFeeBy,
          action: () => updateRouterChargeFeeBy({ signAndSubmitTransaction, sender: account.address.toString(), chargeFeeBy: normalized.chargeFeeBy })
        });
      }

      if (Math.round(normalized.defaultSlippagePercent * 100) !== Math.round(Number(before.defaultSlippagePercent || 0) * 100)) {
        changes.push({
          id: 'slippage',
          label: 'Default Slippage',
          from: `${before.defaultSlippagePercent}%`,
          to: `${normalized.defaultSlippagePercent}%`,
          action: () => updateRouterDefaultSlippage({ signAndSubmitTransaction, sender: account.address.toString(), defaultSlippagePercent: normalized.defaultSlippagePercent })
        });
      }

      if (normalized.paused !== Boolean(before.paused)) {
        changes.push({
          id: 'pause',
          label: 'Router Pause State',
          from: before.paused ? 'Paused' : 'Active',
          to: normalized.paused ? 'Paused' : 'Active',
          action: () => setRouterPaused({ signAndSubmitTransaction, sender: account.address.toString(), paused: normalized.paused })
        });
      }

      if (changes.length === 0) {
        showMessage('No on-chain changes detected');
        return;
      }

      setPendingChanges(changes);
      setSuccessMessage('Review your changes in the Commit Queue below.');

    } catch (error) {
      showMessage(error?.message || 'Failed to detect changes', true);
    }
  }, [swapSettings, connected, account, signAndSubmitTransaction, movementClient, onChainSettings, showMessage]);

  const executeChanges = useCallback(async () => {
    setRouterSaving(true);
    let successCount = 0;
    try {
      for (const change of pendingChanges) {
        await trackTransaction(`Updating ${change.label}`, change.action());
        successCount += 1;
      }

      // Update local storage only if all succeeded or at end of loop
      const nextLocal = updateSwapSettings({
        feeInBps: Number(swapSettings.feeInBps),
        feeReceiver: swapSettings.feeReceiver,
        chargeFeeBy: swapSettings.chargeFeeBy,
        defaultSlippagePercent: Number(swapSettings.defaultSlippagePercent),
        routingMode: 'mosaic',
      });

      setSwapSettings((prev) => ({ ...prev, ...nextLocal }));
      await loadRouterSettings();
      setPendingChanges([]);
      showMessage(`Successfully applied ${successCount} changes on-chain`);
    } catch (error) {
      showMessage(`Applied ${successCount} changes. Failed on remaining: ${error.message}`, true);
    } finally {
      setRouterSaving(false);
    }
  }, [pendingChanges, trackTransaction, swapSettings, loadRouterSettings, showMessage]);


  const resetSwapSettings = useCallback(async () => {
    const local = getSwapSettings();
    if (movementClient && isRouterConfigured()) {
      await loadRouterSettings();
      showMessage('Reset to on-chain router settings');
      return;
    }

    setSwapSettings(local);
    showMessage('Swap settings reset to saved values');
  }, [movementClient, loadRouterSettings, showMessage]);

  if (!connected) {
    return (
      <div className="admin-page">
        <div className="admin-container">
          <div className="admin-access-gate">
            <div className="admin-access-icon">🔒</div>
            <h2>Admin Access</h2>
            <p>Connect the admin wallet to continue.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="admin-page">
        <div className="admin-background">
          <div className="gradient-orb orb-1" />
          <div className="gradient-orb orb-2" />
        </div>
        <div className="admin-container">
          <div className="admin-access-gate admin-access-denied">
            <div className="gate-glow" />
            <div className="admin-access-icon">🛡️</div>
            <h2>Admin Authentication</h2>
            <div className="admin-auth-details">
              <p className="auth-addr-row">
                Connected: <code className="ba-inline-code">{connectedAddress?.slice(0, 10)}...</code>
              </p>
              <div className="auth-status-chip fail">
                <span>❌ Unauthorized Address</span>
              </div>
            </div>
            <p className="gate-hint">
              This panel is restricted to the contract admin specified in <code>badges.move</code>.
              {onChainAdmin && <div className="current-admin-hint">Expected Admin: <code>{onChainAdmin.slice(0, 10)}...</code></div>}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-container">
        <div className="admin-header">
          <h1>Admin Panel</h1>
        </div>

        {errorMessage && <div className="admin-message error">{errorMessage}</div>}
        {successMessage && <div className="admin-message success">{successMessage}</div>}

        {pendingTx && (
          <div className="admin-tx-tracker-banner">
            <span className="tx-status-icon">🔄</span>
            <span className="tx-status-text">Pending: {pendingTx.description}</span>
          </div>
        )}


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
              aria-selected={activeTab === 'entities'}
              className={`admin-tab ${activeTab === 'entities' ? 'active' : ''}`}
              onClick={() => setActiveTab('entities')}
            >
              <span className="admin-tab-icon" aria-hidden="true">🏢</span>
              <span className="admin-tab-text">
                <span className="admin-tab-title">Entities</span>
                <span className="admin-tab-meta">Track and name protocol wallets</span>
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
        {activeTab === 'entities' && <EntityAdmin />}

        {activeTab === 'settings' && (
          <div className="admin-content">
            <div className="admin-settings-section">
              <h2>Mosaic Swap Settings</h2>
              <p className="section-description">
                Configure router partner settings on-chain. Routing is fixed to Mosaic.
              </p>
              <div className="admin-summary-card" style={{ marginBottom: '1rem' }}>
                <h4>Router Status</h4>
                <div className="admin-summary-item">
                  <span>Contract</span>
                  <strong>{isRouterConfigured() ? 'Configured' : 'Missing VITE_SWAP_ROUTER_ADDRESS'}</strong>
                </div>
                <div className="admin-summary-item">
                  <span>Source</span>
                  <strong>{routerLoading ? 'Loading on-chain...' : (onChainSettings ? 'On-chain' : 'Local fallback')}</strong>
                </div>
                <div className="admin-summary-item">
                  <span>Paused</span>
                  <strong>{swapSettings.paused ? 'Yes' : 'No'}</strong>
                </div>
              </div>

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
                    <label className="admin-checkbox" style={{ marginTop: '0.75rem' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(swapSettings.paused)}
                        onChange={(e) => setSwapSettings((prev) => ({ ...prev, paused: e.target.checked }))}
                      />
                      Pause swap recording on-chain (`set_paused`)
                    </label>
                  </div>

                  <div className="admin-settings-card">
                    <h3>Swap Protocol Fee</h3>
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
                      <label>Swap Fee Receiver (Treasury)</label>
                      <input
                        type="text"
                        value={swapSettings.feeReceiver}
                        onChange={(e) => setSwapSettings((prev) => ({ ...prev, feeReceiver: e.target.value }))}
                        placeholder="0x..."
                      />
                    </div>

                    <div className="admin-form-group">
                      <label>Charge Fee By</label>
                      <select
                        value={String(swapSettings.chargeFeeBy || (swapSettings.isFeeIn === false ? 'token_out' : 'token_in'))}
                        onChange={(e) => setSwapSettings((prev) => ({
                          ...prev,
                          chargeFeeBy: e.target.value === 'token_out' ? 'token_out' : 'token_in',
                        }))}
                      >
                        <option value="token_in">token_in (charge input token)</option>
                        <option value="token_out">token_out (charge output token)</option>
                      </select>
                      <small className="admin-field-hint">
                        Matches router contract field `charge_fee_by`.
                      </small>
                    </div>
                  </div>
                </div>

                <aside className="admin-settings-sidebar">
                  <div className="admin-settings-card">
                    <h3>Mosaic Status</h3>
                    <p className="admin-field-hint">
                      ✅ Connected to Mosaic Proxy. API keys are securely managed by the backend.
                    </p>
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
                      <span>Paused</span>
                      <strong>{swapSettings.paused ? 'Yes' : 'No'}</strong>
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

              {pendingChanges.length > 0 && (
                <div className="admin-commit-queue">
                  <div className="commit-queue-header">
                    <h3>Commit Queue ({pendingChanges.length} changes)</h3>
                    <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setPendingChanges([])}>Cancel All</button>
                  </div>
                  <div className="commit-queue-list">
                    {pendingChanges.map(change => (
                      <div key={change.id} className="commit-item">
                        <span className="commit-label">{change.label}</span>
                        <div className="commit-diff">
                           <span className="diff-old">{String(change.from || 'low')}</span>
                           <span className="diff-arrow">→</span>
                           <span className="diff-new">{String(change.to || 'high')}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="commit-queue-actions">
                    <button className="admin-btn admin-btn-primary admin-btn-large" onClick={executeChanges} disabled={routerSaving}>
                      {routerSaving ? 'Executing Sequential Loop...' : 'Confirm & Execute Changes'}
                    </button>
                  </div>
                </div>
              )}

              <div className="admin-form-actions">

                <button className="admin-btn admin-btn-primary" onClick={handleSaveSettings} disabled={routerSaving || routerLoading}>
                  {routerSaving ? 'Saving On-Chain...' : 'Save Swap Settings'}
                </button>
                <button className="admin-btn admin-btn-secondary" onClick={resetSwapSettings} disabled={routerSaving || routerLoading}>
                  {routerLoading ? 'Refreshing...' : 'Reset Changes'}
                </button>
                <button className="admin-btn admin-btn-secondary" onClick={loadRouterSettings} disabled={routerSaving || routerLoading || !isRouterConfigured()}>
                  Sync From Chain
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
