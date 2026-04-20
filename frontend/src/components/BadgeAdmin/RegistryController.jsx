import React, { useState, useCallback, useEffect } from 'react';
import {
  fetchRegistryInfo,
  initializeRegistry,
  setGlobalPaused,
  updateSignerPubKey,
  setFeeTreasury,
  initiateAdminTransfer,
  acceptAdminTransfer,
} from '../../services/badgeService.js';

const isZeroAddress = (addr) => {
  if (!addr) return true;
  const raw = String(addr).toLowerCase().replace(/^0x/, '');
  return !raw || /^0+$/.test(raw);
};

export default function RegistryController({ 
  movementClient, 
  account, 
  connected, 
  signAndSubmitTransaction, 
  showMessage 
}) {
  const [registryInfo, setRegistryInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [globalPauseLoading, setGlobalPauseLoading] = useState(false);
  const [signerKeyInput, setSignerKeyInput] = useState('');
  const [signerKeyLoading, setSignerKeyLoading] = useState(false);
  const [treasuryInput, setTreasuryInput] = useState('');
  const [treasuryLoading, setTreasuryLoading] = useState(false);
  const [adminTransferInput, setAdminTransferInput] = useState('');
  const [adminTransferLoading, setAdminTransferLoading] = useState(false);
  const [acceptTransferLoading, setAcceptTransferLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);

  const [initForm, setInitForm] = useState({
    signerPubKeyHex: '',
    feeTreasury: account?.address?.toString() || '',
  });

  const loadRegistryInfo = useCallback(async () => {
    if (!movementClient) return;
    setLoading(true);
    try {
      const info = await fetchRegistryInfo(movementClient);
      setRegistryInfo(info);
      if (info?.signerPubKeyHex) setSignerKeyInput(info.signerPubKeyHex || '');
      if (info?.feeTreasury) setTreasuryInput(info.feeTreasury || '');
    } catch (err) {
      console.error('[RegistryController] Failed to load info', err);
    } finally {
      setLoading(false);
    }
  }, [movementClient]);

  useEffect(() => {
    loadRegistryInfo();
  }, [loadRegistryInfo]);

  const handleInitializeRegistry = async () => {
    if (!connected || !account || !signAndSubmitTransaction) return;
    if (!initForm.signerPubKeyHex || initForm.signerPubKeyHex.length !== 64) {
      showMessage('error', 'Valid 64-char signer public key required');
      return;
    }
    setInitLoading(true);
    try {
      await initializeRegistry({
        signAndSubmitTransaction,
        sender: account.address.toString(),
        signerPubKeyHex: initForm.signerPubKeyHex,
        feeTreasury: initForm.feeTreasury || account.address.toString()
      });
      showMessage('success', 'Registry initialized successfully!');
      loadRegistryInfo();
    } catch (err) {
      showMessage('error', err.message || 'Initialization failed');
    } finally {
      setInitLoading(false);
    }
  };

  const handleSetGlobalPaused = async (isPaused) => {
    if (!connected || !account || !signAndSubmitTransaction) return;
    setGlobalPauseLoading(true);
    try {
      await setGlobalPaused({ signAndSubmitTransaction, sender: account.address.toString(), isPaused });
      showMessage('success', isPaused ? 'Registry paused' : 'Registry resumed');
      loadRegistryInfo();
    } catch (err) {
      showMessage('error', err.message || 'Operation failed');
    } finally {
      setGlobalPauseLoading(false);
    }
  };

  const handleUpdateSignerKey = async () => {
    if (!connected) return;
    const cleanKey = signerKeyInput.replace(/^0x/, '');
    if (cleanKey.length !== 64) {
        showMessage('error', 'Invalid public key length (must be 64 hex chars)');
        return;
    }
    setSignerKeyLoading(true);
    try {
      await updateSignerPubKey({ signAndSubmitTransaction, sender: account.address.toString(), newPubKeyHex: cleanKey });
      showMessage('success', 'Signer public key updated on-chain');
      loadRegistryInfo();
    } catch (err) {
      showMessage('error', err.message || 'Update failed');
    } finally {
      setSignerKeyLoading(false);
    }
  };

  const handleUpdateTreasury = async () => {
    if (!connected) return;
    if (!treasuryInput) {
      showMessage('error', 'Valid treasury address required');
      return;
    }
    setTreasuryLoading(true);
    try {
      await setFeeTreasury({ signAndSubmitTransaction, sender: account.address.toString(), newTreasury: treasuryInput });
      showMessage('success', 'Fee treasury wallet updated!');
      loadRegistryInfo();
    } catch (err) {
      showMessage('error', err.message || 'Update failed');
    } finally {
      setTreasuryLoading(false);
    }
  };

  const handleInitiateAdminTransfer = async () => {
    if (!connected) return;
    setAdminTransferLoading(true);
    try {
      await initiateAdminTransfer({ signAndSubmitTransaction, sender: account.address.toString(), newAdmin: adminTransferInput });
      showMessage('success', 'Admin transfer initiated');
      loadRegistryInfo();
    } catch (err) {
      showMessage('error', err.message || 'Initiation failed');
    } finally {
      setAdminTransferLoading(false);
    }
  };

  const handleAcceptAdminTransfer = async () => {
    if (!connected) return;
    setAcceptTransferLoading(true);
    try {
      await acceptAdminTransfer({ signAndSubmitTransaction, sender: account.address.toString() });
      showMessage('success', 'Admin transfer accepted! You are now the registry admin.');
      loadRegistryInfo();
    } catch (err) {
      showMessage('error', err.message || 'Accept failed');
    } finally {
      setAcceptTransferLoading(false);
    }
  };

  if (loading && !registryInfo) return <div className="ba-loading">Loading registry configuration...</div>;

  if (registryInfo?._error === 'NOT_INITIALIZED') {
    return (
      <div className="ba-setup-container">
        <div className="ba-setup-header">
          <span className="ba-setup-icon">🚀</span>
          <h4>Contract Setup Required</h4>
          <p>Initial module configuration is required before badges can be processed.</p>
        </div>
        <div className="ba-field">
          <label>Signer Public Key (Ed25519) <span className="ba-required">*</span></label>
          <input 
             type="text" className="ba-input" 
             placeholder="e.g. 64 hex chars..."
             value={initForm.signerPubKeyHex}
             onChange={e => setInitForm(p => ({ ...p, signerPubKeyHex: e.target.value }))}
          />
          <p className="ba-hint">Used to verify backend-signed minting requests.</p>
        </div>
        <div className="ba-field">
          <label>Initial Fee Treasury</label>
          <input 
             type="text" className="ba-input" 
             value={initForm.feeTreasury}
             onChange={e => setInitForm(p => ({ ...p, feeTreasury: e.target.value }))}
          />
          <p className="ba-hint">Address that receives badge minting fees. Defaults to your wallet.</p>
        </div>
        <div className="ba-setup-actions">
          <button className="ba-btn ba-btn-primary ba-btn-large" onClick={handleInitializeRegistry} disabled={initLoading}>
            {initLoading ? 'Initializing...' : 'Initialize Registry'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ba-registry-section">
      <div className="ba-registry-section-header">
        <h3>Registry Global Controls</h3>
        <button className="ba-btn ba-btn-secondary ba-btn-sm" onClick={loadRegistryInfo}>🔄 Refresh State</button>
      </div>

      {registryInfo && (
        <>
          <div className="ba-registry-stats-grid">
            <div className="ba-registry-stat">
              <span className="ba-registry-stat-label">Admin Controller</span>
              <span className="ba-registry-stat-value">{registryInfo.admin?.slice(0, 14)}...</span>
            </div>
            <div className="ba-registry-stat">
              <span className="ba-registry-stat-label">Treasury Wallet</span>
              <span className="ba-registry-stat-value">{registryInfo.feeTreasury?.slice(0, 14)}...</span>
            </div>
            <div className="ba-registry-stat">
              <span className="ba-registry-stat-label">Registry Badge Count</span>
              <span className="ba-registry-stat-value">{registryInfo.badgeCount}</span>
            </div>
          </div>

          <div className={`ba-registry-status-row ${registryInfo.paused ? 'ba-registry-paused' : 'ba-registry-active'}`}>
            <span>{registryInfo.paused ? '⏸ Registry is currently PAUSED' : '✅ Registry is currently ACTIVE'}</span>
            <button 
              className={`ba-btn ${registryInfo.paused ? 'ba-btn-success' : 'ba-btn-warning'}`}
              onClick={() => handleSetGlobalPaused(!registryInfo.paused)}
              disabled={globalPauseLoading}
            >
              {globalPauseLoading ? '...' : (registryInfo.paused ? '▶️ Resume' : '⏸ Pause Registry')}
            </button>
          </div>

          <div className="ba-registry-form-group">
            <div className="ba-registry-key-section">
              <h4>🛡️ Update Signer Public Key</h4>
              <p className="ba-hint">Replaces the Ed25519 key used for backend minting proofs.</p>
              <div className="ba-key-update-row">
                <input 
                  type="text" className="ba-input ba-key-input" value={signerKeyInput} 
                  onChange={e => setSignerKeyInput(e.target.value)} 
                />
                <button className="ba-btn ba-btn-primary" onClick={handleUpdateSignerKey} disabled={signerKeyLoading}>
                  {signerKeyLoading ? 'Updating...' : 'Update Key'}
                </button>
              </div>
            </div>

            <div className="ba-registry-key-section">
              <h4>💰 Update Fee Treasury</h4>
              <p className="ba-hint">Update the wallet address that receives all on-chain mint fees.</p>
              <div className="ba-key-update-row">
                <input 
                  type="text" className="ba-input ba-key-input" value={treasuryInput} 
                  onChange={e => setTreasuryInput(e.target.value)} 
                />
                <button className="ba-btn ba-btn-primary" onClick={handleUpdateTreasury} disabled={treasuryLoading}>
                  {treasuryLoading ? 'Updating...' : 'Update Treasury'}
                </button>
              </div>
            </div>
          </div>

          <div className="ba-registry-key-section ba-danger-zone">
            <h4>🔑 Administrative Transfer</h4>
            <p className="ba-hint">Change the primary administrator of the badge module.</p>
            {registryInfo.pendingAdmin && !isZeroAddress(registryInfo.pendingAdmin) && (
              <div className="ba-pending-transfer">
                <span>Pending Transfer To: <code>{registryInfo.pendingAdmin.slice(0, 16)}...</code></span>
                <button className="ba-btn ba-btn-success ba-btn-sm" onClick={handleAcceptAdminTransfer}>Accept Transfer</button>
              </div>
            )}
            <div className="ba-key-update-row">
              <input 
                type="text" className="ba-input ba-key-input" 
                placeholder="New admin 0x address..."
                value={adminTransferInput} 
                onChange={e => setAdminTransferInput(e.target.value)} 
              />
              <button className="ba-btn ba-btn-warning" onClick={handleInitiateAdminTransfer} disabled={adminTransferLoading}>
                {adminTransferLoading ? 'Initiating...' : 'Initiate Transfer'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
