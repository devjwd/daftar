import React, { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import './Admin.css';
import {
  addToken,
  updateToken,
  deleteToken,
  getCustomTokens,
  exportAdminData,
  importAdminData,
  clearAllAdminData,
} from '../services/adminService';
import { DEFAULT_NETWORK } from '../config/network';
import { BADGE_RULES, BADGE_CATEGORIES, ACTIVITY_BADGE_TIERS, LONGEVITY_BADGE_TIERS, getRuleLabel } from '../config/badges';
import {
  fetchBadges,
  fetchBadgeIds,
  createBadgeAllowlist,
  createBadgeMinBalance,
  addAllowlistEntries,
  buildMetadataJson,
  buildMetadataDataUri,
  computeSha256Hex,
  ruleLabel,
} from '../services/badgeService';
import {
  getTransactionCount,
  getDaysOnchain,
  checkActivityEligibility,
  checkLongevityEligibility,
  getEligibleActivityBadges,
  getEligibleLongevityBadges,
  getEligibilityReport,
} from '../services/eligibilityService';
import { imageToBase64, compressImage } from '../services/profileService';
import { isValidAddress } from '../utils/tokenUtils';

export default function Admin() {
  const [activeTab, setActiveTab] = useState('tokens'); // 'tokens', 'badges', or 'settings'
  const [badgeSubTab, setBadgeSubTab] = useState('manual'); // 'manual', 'activity', 'longevity', 'roles'
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [customTokens, setCustomTokens] = useState([]);
  const [onChainBadges, setOnChainBadges] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [editingToken, setEditingToken] = useState(null);
  const [badgeBusy, setBadgeBusy] = useState(false);
  const [badgeImagePreview, setBadgeImagePreview] = useState('');
  const [selectedActivityTier, setSelectedActivityTier] = useState(ACTIVITY_BADGE_TIERS[0]);
  const [selectedLongevityTier, setSelectedLongevityTier] = useState(LONGEVITY_BADGE_TIERS[0]);
  const [eligibilityCheckAddress, setEligibilityCheckAddress] = useState('');
  const [eligibilityReport, setEligibilityReport] = useState(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [badgeRoles, setBadgeRoles] = useState([]);
  const [newRoleForm, setNewRoleForm] = useState({ name: '', description: '', badgeIds: [] });

  const movementClient = useMemo(
    () =>
      new Aptos(
        new AptosConfig({
          network: Network.CUSTOM,
          fullnode: DEFAULT_NETWORK.rpc,
        })
      ),
    []
  );

  // Token form state
  const [tokenForm, setTokenForm] = useState({
    address: '',
    symbol: '',
    name: '',
    decimals: 8,
    isNative: false,
  });

  // Badge form state
  const [badgeForm, setBadgeForm] = useState({
    name: '',
    description: '',
    imageUri: '',
    metadataUri: '',
    metadataHash: '',
    ruleType: BADGE_RULES.ALLOWLIST,
    ruleNote: '',
    minBalance: '',
    coinType: '',
    coinTypeStr: '',
    allowlistText: '',
    minTransactionCount: '1',
    minDaysOnchain: '7',
  });

  // Load data on mount
  useEffect(() => {
    loadData();
    loadBadges();
    loadRoles();
  }, []);

  const loadData = () => {
    setCustomTokens(getCustomTokens());
  };

  const loadRoles = () => {
    const roles = JSON.parse(localStorage.getItem('badge_roles') || '[]');
    setBadgeRoles(roles);
  };

  const loadBadges = async () => {
    try {
      const badges = await fetchBadges(movementClient);
      setOnChainBadges(badges);
    } catch (error) {
      console.error('Failed to load badges:', error);
    }
  };

  // Show message for 3 seconds
  const showMessage = (message, isError = false) => {
    if (isError) {
      setErrorMessage(message);
      setTimeout(() => setErrorMessage(''), 3000);
    } else {
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  // --- TOKEN HANDLERS ---
  const handleAddToken = (e) => {
    e.preventDefault();
    setErrorMessage('');

    try {
      if (editingToken) {
        updateToken(editingToken.id, tokenForm);
        showMessage('Token updated successfully!');
        setEditingToken(null);
      } else {
        addToken(tokenForm);
        showMessage('Token added successfully!');
      }

      setTokenForm({
        address: '',
        symbol: '',
        name: '',
        decimals: 8,
        isNative: false,
      });

      loadData();
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const handleEditToken = (token) => {
    setEditingToken(token);
    setTokenForm({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      isNative: token.isNative,
    });
  };

  const handleDeleteToken = (tokenId) => {
    if (window.confirm('Are you sure you want to delete this token?')) {
      try {
        deleteToken(tokenId);
        showMessage('Token deleted successfully!');
        loadData();
      } catch (error) {
        showMessage(error.message, true);
      }
    }
  };

  const handleCancelEditToken = () => {
    setEditingToken(null);
    setTokenForm({
      address: '',
      symbol: '',
      name: '',
      decimals: 8,
      isNative: false,
    });
  };

  // --- BADGE HANDLERS ---
  const resetBadgeForm = () => {
    setBadgeForm({
      name: '',
      description: '',
      imageUri: '',
      metadataUri: '',
      metadataHash: '',
      ruleType: BADGE_RULES.ALLOWLIST,
      ruleNote: '',
      minBalance: '',
      coinType: '',
      coinTypeStr: '',
      allowlistText: '',
      minTransactionCount: '1',
      minDaysOnchain: '7',
    });
    setBadgeImagePreview('');
  };

  const parseAllowlist = (input) => {
    if (!input) return [];
    return input
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => isValidAddress(entry));
  };

  const handleBadgeImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const base64 = await imageToBase64(file);
      const compressed = await compressImage(base64);
      setBadgeImagePreview(compressed);
      setBadgeForm((prev) => ({
        ...prev,
        imageUri: compressed,
      }));
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const handleGenerateMetadata = async () => {
    if (!badgeForm.name || !badgeForm.description) {
      showMessage('Please enter name and description first', true);
      return;
    }

    const metadataJson = buildMetadataJson({
      name: badgeForm.name,
      description: badgeForm.description,
      imageUri: badgeForm.imageUri,
      attributes: [
        {
          trait_type: 'Eligibility',
          value: badgeForm.ruleNote || ruleLabel(Number(badgeForm.ruleType)),
        },
      ],
    });

    const metadataUri = buildMetadataDataUri(metadataJson);
    const metadataHash = await computeSha256Hex(metadataJson);

    setBadgeForm((prev) => ({
      ...prev,
      metadataUri,
      metadataHash,
    }));
  };

  const handleAddBadge = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    if (!connected || !account || !signAndSubmitTransaction) {
      showMessage('Connect a wallet that supports transactions', true);
      return;
    }

    if (!badgeForm.name || !badgeForm.description) {
      showMessage('Name and description are required', true);
      return;
    }

    if (!badgeForm.imageUri) {
      showMessage('Please upload an image or set an image URI', true);
      return;
    }

    const ruleType = Number(badgeForm.ruleType);
    const isMinBalance = ruleType === BADGE_RULES.MIN_BALANCE;

    if (isMinBalance && (!badgeForm.coinType || !badgeForm.minBalance)) {
      showMessage('Coin type and minimum balance are required', true);
      return;
    }

    const allowlistAddresses = parseAllowlist(badgeForm.allowlistText);

    try {
      setBadgeBusy(true);

      const existingIds = await fetchBadgeIds(movementClient);
      const metadataJson = buildMetadataJson({
        name: badgeForm.name,
        description: badgeForm.description,
        imageUri: badgeForm.imageUri,
        attributes: [
          {
            trait_type: 'Eligibility',
            value: badgeForm.ruleNote || ruleLabel(ruleType),
          },
        ],
      });

      const metadataUri = badgeForm.metadataUri || buildMetadataDataUri(metadataJson);
      const metadataHash = badgeForm.metadataHash || (await computeSha256Hex(metadataJson));

      const response = isMinBalance
        ? await createBadgeMinBalance({
            signAndSubmitTransaction,
            sender: account.address,
            name: badgeForm.name,
            description: badgeForm.description,
            imageUri: badgeForm.imageUri,
            metadataUri,
            metadataHash,
            coinType: badgeForm.coinType,
            coinTypeStr: badgeForm.coinTypeStr || badgeForm.coinType,
            minBalance: Number(badgeForm.minBalance),
            ruleNote: badgeForm.ruleNote || '',
          })
        : await createBadgeAllowlist({
            signAndSubmitTransaction,
            sender: account.address,
            name: badgeForm.name,
            description: badgeForm.description,
            imageUri: badgeForm.imageUri,
            metadataUri,
            metadataHash,
            ruleType,
            ruleNote: badgeForm.ruleNote || '',
          });

      if (response?.hash) {
        await movementClient.waitForTransaction({
          transactionHash: response.hash,
          options: { timeoutSecs: 30 },
        });
      }

      const updatedIds = await fetchBadgeIds(movementClient);
      const existingSet = new Set(existingIds.map((id) => Number(id)));
      const newId = updatedIds.map((id) => Number(id)).find((id) => !existingSet.has(id));

      if (newId && allowlistAddresses.length > 0 && !isMinBalance) {
        await addAllowlistEntries({
          signAndSubmitTransaction,
          sender: account.address,
          badgeId: newId,
          addresses: allowlistAddresses,
        });
      }

      showMessage('Badge created on-chain!');
      resetBadgeForm();
      await loadBadges();
    } catch (error) {
      showMessage(error.message || 'Failed to create badge', true);
    } finally {
      setBadgeBusy(false);
    }
  };

  // --- EXPORT/IMPORT HANDLERS ---
  const handleExportData = () => {
    try {
      const data = exportAdminData();
      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(data));
      element.setAttribute('download', `admin-data-${new Date().toISOString().split('T')[0]}.json`);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      showMessage('Data exported successfully!');
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const handleImportData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonData = event.target?.result;
        importAdminData(jsonData);
        showMessage('Data imported successfully!');
        loadData();
      } catch (error) {
        showMessage(error.message, true);
      }
    };
    reader.readAsText(file);
  };

  const handleClearAllData = () => {
    if (
      window.confirm(
        'Are you sure you want to delete ALL custom tokens and badges? This cannot be undone.'
      )
    ) {
      try {
        clearAllAdminData();
        showMessage('All data cleared!');
        loadData();
      } catch (error) {
        showMessage(error.message, true);
      }
    }
  };

  // --- ACTIVITY & LONGEVITY BADGE HANDLERS ---

  const handleCreateActivityBadge = async (e) => {
    e.preventDefault();
    if (!badgeForm.name || !badgeForm.description || !badgeForm.imageUri) {
      showMessage('Name, description, and image are required', true);
      return;
    }

    try {
      setBadgeBusy(true);
      const tier = selectedActivityTier;
      
      const metadataJson = buildMetadataJson({
        name: `${badgeForm.name} (${tier.count}+ Txns)`,
        description: `${badgeForm.description} - ${tier.description}`,
        imageUri: badgeForm.imageUri,
        attributes: [
          { trait_type: 'Type', value: 'Activity Badge' },
          { trait_type: 'Transaction Requirement', value: tier.count.toString() },
          { trait_type: 'Emoji', value: tier.emoji },
        ],
      });

      const metadataUri = buildMetadataDataUri(metadataJson);
      const metadataHash = await computeSha256Hex(metadataJson);

      const response = await createBadgeAllowlist({
        signAndSubmitTransaction,
        sender: account.address,
        name: `${badgeForm.name} (${tier.count}+)`,
        description: `${badgeForm.description} - ${tier.description}`,
        imageUri: badgeForm.imageUri,
        metadataUri,
        metadataHash,
        ruleType: BADGE_RULES.TRANSACTION_COUNT,
        ruleNote: `Requires ${tier.count}+ transactions`,
      });

      if (response?.hash) {
        await movementClient.waitForTransaction({
          transactionHash: response.hash,
          options: { timeoutSecs: 30 },
        });
      }

      showMessage('Activity badge created!');
      resetBadgeForm();
      await loadBadges();
    } catch (error) {
      showMessage(error.message || 'Failed to create activity badge', true);
    } finally {
      setBadgeBusy(false);
    }
  };

  const handleCreateLongevityBadge = async (e) => {
    e.preventDefault();
    if (!badgeForm.name || !badgeForm.description || !badgeForm.imageUri) {
      showMessage('Name, description, and image are required', true);
      return;
    }

    try {
      setBadgeBusy(true);
      const tier = selectedLongevityTier;
      
      const metadataJson = buildMetadataJson({
        name: `${badgeForm.name} (${tier.days} Days)`,
        description: `${badgeForm.description} - ${tier.description}`,
        imageUri: badgeForm.imageUri,
        attributes: [
          { trait_type: 'Type', value: 'Longevity Badge' },
          { trait_type: 'Days Requirement', value: tier.days.toString() },
          { trait_type: 'Emoji', value: tier.emoji },
        ],
      });

      const metadataUri = buildMetadataDataUri(metadataJson);
      const metadataHash = await computeSha256Hex(metadataJson);

      const response = await createBadgeAllowlist({
        signAndSubmitTransaction,
        sender: account.address,
        name: `${badgeForm.name} (${tier.days}d)`,
        description: `${badgeForm.description} - ${tier.description}`,
        imageUri: badgeForm.imageUri,
        metadataUri,
        metadataHash,
        ruleType: BADGE_RULES.DAYS_ONCHAIN,
        ruleNote: `Requires ${tier.days}+ days onchain`,
      });

      if (response?.hash) {
        await movementClient.waitForTransaction({
          transactionHash: response.hash,
          options: { timeoutSecs: 30 },
        });
      }

      showMessage('Longevity badge created!');
      resetBadgeForm();
      await loadBadges();
    } catch (error) {
      showMessage(error.message || 'Failed to create longevity badge', true);
    } finally {
      setBadgeBusy(false);
    }
  };

  const handleCheckEligibility = async () => {
    if (!eligibilityCheckAddress || !isValidAddress(eligibilityCheckAddress)) {
      showMessage('Please enter a valid address', true);
      return;
    }

    try {
      setCheckingEligibility(true);
      const report = await getEligibilityReport(eligibilityCheckAddress);
      setEligibilityReport(report);
    } catch (error) {
      showMessage(error.message || 'Failed to check eligibility', true);
    } finally {
      setCheckingEligibility(false);
    }
  };

  const handleAddRole = () => {
    if (!newRoleForm.name || newRoleForm.badgeIds.length === 0) {
      showMessage('Role name and at least one badge are required', true);
      return;
    }

    const role = {
      id: `role-${Date.now()}`,
      ...newRoleForm,
      createdAt: new Date(),
    };

    const roles = JSON.parse(localStorage.getItem('badge_roles') || '[]');
    roles.push(role);
    localStorage.setItem('badge_roles', JSON.stringify(roles));
    setBadgeRoles(roles);
    setNewRoleForm({ name: '', description: '', badgeIds: [] });
    showMessage('Role created successfully!');
  };

  return (
    <div className="admin-page">
      <div className="admin-container">
        {/* Header */}
        <div className="admin-header">
          <h1>Admin Control Panel</h1>
          <p>Manage tokens and badges for the portfolio</p>
        </div>

        {/* Messages */}
        {successMessage && <div className="admin-success-message">{successMessage}</div>}
        {errorMessage && <div className="admin-error-message">{errorMessage}</div>}

        {/* Tabs */}
        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeTab === 'tokens' ? 'active' : ''}`}
            onClick={() => setActiveTab('tokens')}
          >
            💰 Tokens
          </button>
          <button
            className={`admin-tab ${activeTab === 'badges' ? 'active' : ''}`}
            onClick={() => setActiveTab('badges')}
          >
            🏆 Badges
          </button>
          <button
            className={`admin-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
          </button>
        </div>

        {/* Tokens Tab */}
        {activeTab === 'tokens' && (
          <div className="admin-content">
            {/* Add Token Form */}
            <div className="admin-form-section">
              <h2>{editingToken ? 'Edit Token' : 'Add New Token'}</h2>
              <form onSubmit={handleAddToken} className="admin-form">
                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label htmlFor="address">Token Address *</label>
                    <input
                      id="address"
                      type="text"
                      placeholder="0x..."
                      value={tokenForm.address}
                      onChange={(e) =>
                        setTokenForm({ ...tokenForm, address: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="admin-form-group">
                    <label htmlFor="symbol">Symbol *</label>
                    <input
                      id="symbol"
                      type="text"
                      placeholder="e.g., MOVE"
                      value={tokenForm.symbol}
                      onChange={(e) =>
                        setTokenForm({ ...tokenForm, symbol: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label htmlFor="name">Token Name *</label>
                    <input
                      id="name"
                      type="text"
                      placeholder="e.g., Movement"
                      value={tokenForm.name}
                      onChange={(e) =>
                        setTokenForm({ ...tokenForm, name: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="admin-form-group">
                    <label htmlFor="decimals">Decimals</label>
                    <input
                      id="decimals"
                      type="number"
                      min="0"
                      max="18"
                      value={tokenForm.decimals}
                      onChange={(e) =>
                        setTokenForm({
                          ...tokenForm,
                          decimals: parseInt(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="admin-form-row">
                  <label className="admin-checkbox">
                    <input
                      type="checkbox"
                      checked={tokenForm.isNative}
                      onChange={(e) =>
                        setTokenForm({ ...tokenForm, isNative: e.target.checked })
                      }
                    />
                    <span>Native Token</span>
                  </label>
                </div>

                <div className="admin-form-actions">
                  <button type="submit" className="admin-btn admin-btn-primary">
                    {editingToken ? '💾 Update Token' : '➕ Add Token'}
                  </button>
                  {editingToken && (
                    <button
                      type="button"
                      className="admin-btn admin-btn-secondary"
                      onClick={handleCancelEditToken}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Tokens List */}
            <div className="admin-list-section">
              <h2>Custom Tokens ({customTokens.length})</h2>
              {customTokens.length === 0 ? (
                <div className="admin-empty-state">No custom tokens added yet</div>
              ) : (
                <div className="admin-list">
                  {customTokens.map((token) => (
                    <div key={token.id} className="admin-list-item">
                      <div className="admin-item-header">
                        <div className="admin-item-title">
                          <strong>{token.symbol}</strong> - {token.name}
                        </div>
                        <div className="admin-item-actions">
                          <button
                            className="admin-btn admin-btn-small admin-btn-edit"
                            onClick={() => handleEditToken(token)}
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            className="admin-btn admin-btn-small admin-btn-danger"
                            onClick={() => handleDeleteToken(token.id)}
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <div className="admin-item-details">
                        <p>
                          <span>Address:</span> <code>{token.address}</code>
                        </p>
                        <p>
                          <span>Decimals:</span> {token.decimals}
                        </p>
                        {token.isNative && <p className="admin-badge">Native Token</p>}
                        <p className="admin-item-date">
                          Added {new Date(token.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Badges Tab */}
        {activeTab === 'badges' && (
          <div className="admin-content">
            {/* Badge Sub-tabs */}
            <div className="badge-subtabs">
              <button
                className={`badge-subtab ${badgeSubTab === 'manual' ? 'active' : ''}`}
                onClick={() => setBadgeSubTab('manual')}
              >
                📋 Manual Badges
              </button>
              <button
                className={`badge-subtab ${badgeSubTab === 'activity' ? 'active' : ''}`}
                onClick={() => setBadgeSubTab('activity')}
              >
                📊 Activity Badges
              </button>
              <button
                className={`badge-subtab ${badgeSubTab === 'longevity' ? 'active' : ''}`}
                onClick={() => setBadgeSubTab('longevity')}
              >
                📅 Longevity Badges
              </button>
              <button
                className={`badge-subtab ${badgeSubTab === 'roles' ? 'active' : ''}`}
                onClick={() => setBadgeSubTab('roles')}
              >
                👥 Roles & Permissions
              </button>
              <button
                className={`badge-subtab ${badgeSubTab === 'eligibility' ? 'active' : ''}`}
                onClick={() => setBadgeSubTab('eligibility')}
              >
                ✅ Check Eligibility
              </button>
            </div>

            {/* Manual Badges Tab */}
            {badgeSubTab === 'manual' && (
              <div className="badge-tab-content">
                {/* Add Badge Form */}
                <div className="admin-form-section">
                  <h2>Create Manual Badge</h2>
                  <form onSubmit={handleAddBadge} className="admin-form">
                    <div className="admin-form-row">
                      <div className="admin-form-group">
                        <label htmlFor="badge-name">Badge Name *</label>
                        <input
                          id="badge-name"
                          type="text"
                          placeholder="e.g., Early Member"
                          value={badgeForm.name}
                          onChange={(e) => setBadgeForm({ ...badgeForm, name: e.target.value })}
                          required
                        />
                      </div>
                      <div className="admin-form-group">
                        <label htmlFor="badge-rule">Eligibility Rule *</label>
                        <select
                          id="badge-rule"
                          value={badgeForm.ruleType}
                          onChange={(e) =>
                            setBadgeForm({ ...badgeForm, ruleType: Number(e.target.value) })
                          }
                        >
                          <option value={BADGE_RULES.ALLOWLIST}>Allowlist</option>
                          <option value={BADGE_RULES.MIN_BALANCE}>Minimum Balance</option>
                          <option value={BADGE_RULES.OFFCHAIN_ALLOWLIST}>Off-chain Allowlist</option>
                        </select>
                      </div>
                    </div>

                    <div className="admin-form-row">
                      <div className="admin-form-group full">
                        <label htmlFor="badge-description">Description *</label>
                        <textarea
                          id="badge-description"
                          placeholder="e.g., Joined in the first month"
                          value={badgeForm.description}
                          onChange={(e) =>
                            setBadgeForm({ ...badgeForm, description: e.target.value })
                          }
                          required
                          rows="3"
                        />
                      </div>
                    </div>

                    <div className="admin-form-row">
                      <div className="admin-form-group">
                        <label htmlFor="badge-image">Badge Image *</label>
                        <input
                          id="badge-image"
                          type="file"
                          accept="image/*"
                          onChange={handleBadgeImageUpload}
                        />
                      </div>
                      <div className="admin-form-group">
                        <label htmlFor="badge-image-uri">Image URI *</label>
                        <input
                          id="badge-image-uri"
                          type="text"
                          placeholder="ipfs://... or https://..."
                          value={badgeForm.imageUri}
                          onChange={(e) =>
                            setBadgeForm({ ...badgeForm, imageUri: e.target.value })
                          }
                          required
                        />
                      </div>
                    </div>

                    {badgeImagePreview && (
                      <div className="admin-image-preview">
                        <img src={badgeImagePreview} alt="Badge preview" />
                      </div>
                    )}

                    <div className="admin-form-row">
                      <div className="admin-form-group full">
                        <label htmlFor="badge-rule-note">Eligibility Notes</label>
                        <textarea
                          id="badge-rule-note"
                          placeholder="e.g., Must have 3+ DeFi positions"
                          value={badgeForm.ruleNote}
                          onChange={(e) =>
                            setBadgeForm({ ...badgeForm, ruleNote: e.target.value })
                          }
                          rows="2"
                        />
                      </div>
                    </div>

                    {Number(badgeForm.ruleType) === BADGE_RULES.MIN_BALANCE && (
                      <div className="admin-form-row">
                        <div className="admin-form-group">
                          <label htmlFor="badge-coin-type">Coin Type *</label>
                          <input
                            id="badge-coin-type"
                            type="text"
                            placeholder="0x1::aptos_coin::AptosCoin"
                            value={badgeForm.coinType}
                            onChange={(e) =>
                              setBadgeForm({ ...badgeForm, coinType: e.target.value })
                            }
                            required
                          />
                        </div>
                        <div className="admin-form-group">
                          <label htmlFor="badge-min-balance">Minimum Balance (raw) *</label>
                          <input
                            id="badge-min-balance"
                            type="number"
                            min="0"
                            placeholder="100000000"
                            value={badgeForm.minBalance}
                            onChange={(e) =>
                              setBadgeForm({ ...badgeForm, minBalance: e.target.value })
                            }
                            required
                          />
                        </div>
                      </div>
                    )}

                    {Number(badgeForm.ruleType) !== BADGE_RULES.MIN_BALANCE && (
                      <div className="admin-form-row">
                        <div className="admin-form-group full">
                          <label htmlFor="badge-allowlist">Allowlist Addresses (one per line)</label>
                          <textarea
                            id="badge-allowlist"
                            placeholder="0x123...\n0xabc..."
                            value={badgeForm.allowlistText}
                            onChange={(e) =>
                              setBadgeForm({ ...badgeForm, allowlistText: e.target.value })
                            }
                            rows="4"
                          />
                        </div>
                      </div>
                    )}

                    <div className="admin-form-actions">
                      <button
                        type="submit"
                        className="admin-btn admin-btn-primary"
                        disabled={badgeBusy}
                      >
                        {badgeBusy ? '⏳ Creating...' : '➕ Create Manual Badge'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Badges List */}
                <div className="admin-list-section">
                  <h2>On-chain Badges ({onChainBadges.length})</h2>
                  {onChainBadges.length === 0 ? (
                    <div className="admin-empty-state">No on-chain badges yet</div>
                  ) : (
                    <div className="admin-list">
                      {onChainBadges.map((badge) => (
                        <div key={badge.id} className="admin-list-item">
                          <div className="admin-item-header">
                            <div className="admin-item-title">
                              {badge.imageUri ? (
                                <img
                                  src={badge.imageUri}
                                  alt={badge.name}
                                  className="admin-badge-image"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              ) : (
                                <span className="admin-badge-icon">🏆</span>
                              )}
                              <strong>{badge.name}</strong>
                            </div>
                          </div>
                          <div className="admin-item-details">
                            <p>
                              <span>Description:</span> {badge.description}
                            </p>
                            <p>
                              <span>Rule:</span> {ruleLabel(badge.ruleType)}
                            </p>
                            {badge.ruleNote && (
                              <p>
                                <span>Note:</span> {badge.ruleNote}
                              </p>
                            )}
                            {badge.ruleType === BADGE_RULES.MIN_BALANCE && (
                              <p>
                                <span>Minimum:</span> {badge.minBalance} ({badge.coinTypeStr})
                              </p>
                            )}
                            <p className="admin-item-date">
                              Added {new Date(badge.createdAt * 1000).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Activity Badges Tab */}
            {badgeSubTab === 'activity' && (
              <div className="badge-tab-content">
                <div className="admin-form-section">
                  <h2>Create Activity Badge (Transaction-Based)</h2>
                  <p className="section-description">Badges awarded based on transaction count milestones</p>
                  
                  <form onSubmit={handleCreateActivityBadge} className="admin-form">
                    <div className="admin-form-row">
                      <div className="admin-form-group">
                        <label htmlFor="activity-name">Badge Name *</label>
                        <input
                          id="activity-name"
                          type="text"
                          placeholder="e.g., Transaction Master"
                          value={badgeForm.name}
                          onChange={(e) => setBadgeForm({ ...badgeForm, name: e.target.value })}
                          required
                        />
                      </div>
                      <div className="admin-form-group">
                        <label htmlFor="activity-tier">Transaction Requirement *</label>
                        <select
                          id="activity-tier"
                          value={selectedActivityTier.count}
                          onChange={(e) => {
                            const tier = ACTIVITY_BADGE_TIERS.find(t => t.count === Number(e.target.value));
                            if (tier) setSelectedActivityTier(tier);
                          }}
                        >
                          {ACTIVITY_BADGE_TIERS.map((tier) => (
                            <option key={tier.count} value={tier.count}>
                              {tier.emoji} {tier.name} ({tier.count}+ transactions)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="tier-preview">
                      <span className="tier-emoji">{selectedActivityTier.emoji}</span>
                      <div className="tier-info">
                        <strong>{selectedActivityTier.name}</strong>
                        <p>{selectedActivityTier.description}</p>
                      </div>
                    </div>

                    <div className="admin-form-row">
                      <div className="admin-form-group full">
                        <label htmlFor="activity-description">Description *</label>
                        <textarea
                          id="activity-description"
                          placeholder="e.g., Earned by completing 10+ transactions on the network"
                          value={badgeForm.description}
                          onChange={(e) =>
                            setBadgeForm({ ...badgeForm, description: e.target.value })
                          }
                          required
                          rows="3"
                        />
                      </div>
                    </div>

                    <div className="admin-form-row">
                      <div className="admin-form-group">
                        <label htmlFor="activity-image">Badge Image *</label>
                        <input
                          id="activity-image"
                          type="file"
                          accept="image/*"
                          onChange={handleBadgeImageUpload}
                        />
                      </div>
                      <div className="admin-form-group">
                        <label htmlFor="activity-image-uri">Image URI *</label>
                        <input
                          id="activity-image-uri"
                          type="text"
                          placeholder="ipfs://... or https://..."
                          value={badgeForm.imageUri}
                          onChange={(e) =>
                            setBadgeForm({ ...badgeForm, imageUri: e.target.value })
                          }
                          required
                        />
                      </div>
                    </div>

                    {badgeImagePreview && (
                      <div className="admin-image-preview">
                        <img src={badgeImagePreview} alt="Badge preview" />
                      </div>
                    )}

                    <div className="admin-form-actions">
                      <button
                        type="submit"
                        className="admin-btn admin-btn-primary"
                        disabled={badgeBusy}
                      >
                        {badgeBusy ? '⏳ Creating...' : '📊 Create Activity Badge'}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="badge-tiers-grid">
                  <h3>Available Activity Tiers</h3>
                  <div className="tiers-list">
                    {ACTIVITY_BADGE_TIERS.map((tier) => (
                      <div key={tier.count} className="tier-card">
                        <span className="tier-emoji">{tier.emoji}</span>
                        <strong>{tier.name}</strong>
                        <p>{tier.count}+ transactions</p>
                        <p className="tier-desc">{tier.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Longevity Badges Tab */}
            {badgeSubTab === 'longevity' && (
              <div className="badge-tab-content">
                <div className="admin-form-section">
                  <h2>Create Longevity Badge (Days Onchain)</h2>
                  <p className="section-description">Badges awarded based on how long users have been onchain</p>
                  
                  <form onSubmit={handleCreateLongevityBadge} className="admin-form">
                    <div className="admin-form-row">
                      <div className="admin-form-group">
                        <label htmlFor="longevity-name">Badge Name *</label>
                        <input
                          id="longevity-name"
                          type="text"
                          placeholder="e.g., Veteran Member"
                          value={badgeForm.name}
                          onChange={(e) => setBadgeForm({ ...badgeForm, name: e.target.value })}
                          required
                        />
                      </div>
                      <div className="admin-form-group">
                        <label htmlFor="longevity-tier">Days Requirement *</label>
                        <select
                          id="longevity-tier"
                          value={selectedLongevityTier.days}
                          onChange={(e) => {
                            const tier = LONGEVITY_BADGE_TIERS.find(t => t.days === Number(e.target.value));
                            if (tier) setSelectedLongevityTier(tier);
                          }}
                        >
                          {LONGEVITY_BADGE_TIERS.map((tier) => (
                            <option key={tier.days} value={tier.days}>
                              {tier.emoji} {tier.name} ({tier.days}+ days)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="tier-preview">
                      <span className="tier-emoji">{selectedLongevityTier.emoji}</span>
                      <div className="tier-info">
                        <strong>{selectedLongevityTier.name}</strong>
                        <p>{selectedLongevityTier.description}</p>
                      </div>
                    </div>

                    <div className="admin-form-row">
                      <div className="admin-form-group full">
                        <label htmlFor="longevity-description">Description *</label>
                        <textarea
                          id="longevity-description"
                          placeholder="e.g., Earned by being onchain for 100+ days"
                          value={badgeForm.description}
                          onChange={(e) =>
                            setBadgeForm({ ...badgeForm, description: e.target.value })
                          }
                          required
                          rows="3"
                        />
                      </div>
                    </div>

                    <div className="admin-form-row">
                      <div className="admin-form-group">
                        <label htmlFor="longevity-image">Badge Image *</label>
                        <input
                          id="longevity-image"
                          type="file"
                          accept="image/*"
                          onChange={handleBadgeImageUpload}
                        />
                      </div>
                      <div className="admin-form-group">
                        <label htmlFor="longevity-image-uri">Image URI *</label>
                        <input
                          id="longevity-image-uri"
                          type="text"
                          placeholder="ipfs://... or https://..."
                          value={badgeForm.imageUri}
                          onChange={(e) =>
                            setBadgeForm({ ...badgeForm, imageUri: e.target.value })
                          }
                          required
                        />
                      </div>
                    </div>

                    {badgeImagePreview && (
                      <div className="admin-image-preview">
                        <img src={badgeImagePreview} alt="Badge preview" />
                      </div>
                    )}

                    <div className="admin-form-actions">
                      <button
                        type="submit"
                        className="admin-btn admin-btn-primary"
                        disabled={badgeBusy}
                      >
                        {badgeBusy ? '⏳ Creating...' : '📅 Create Longevity Badge'}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="badge-tiers-grid">
                  <h3>Available Longevity Tiers</h3>
                  <div className="tiers-list">
                    {LONGEVITY_BADGE_TIERS.map((tier) => (
                      <div key={tier.days} className="tier-card">
                        <span className="tier-emoji">{tier.emoji}</span>
                        <strong>{tier.name}</strong>
                        <p>{tier.days}+ days onchain</p>
                        <p className="tier-desc">{tier.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Roles & Permissions Tab */}
            {badgeSubTab === 'roles' && (
              <div className="badge-tab-content">
                <div className="admin-form-section">
                  <h2>Create Badge Role</h2>
                  <p className="section-description">Group badges together as roles for permission management</p>
                  
                  <form onSubmit={(e) => { e.preventDefault(); handleAddRole(); }} className="admin-form">
                    <div className="admin-form-row">
                      <div className="admin-form-group">
                        <label htmlFor="role-name">Role Name *</label>
                        <input
                          id="role-name"
                          type="text"
                          placeholder="e.g., VIP Member"
                          value={newRoleForm.name}
                          onChange={(e) => setNewRoleForm({ ...newRoleForm, name: e.target.value })}
                          required
                        />
                      </div>
                    </div>

                    <div className="admin-form-row">
                      <div className="admin-form-group full">
                        <label htmlFor="role-description">Description *</label>
                        <textarea
                          id="role-description"
                          placeholder="e.g., Users with premium badges"
                          value={newRoleForm.description}
                          onChange={(e) => setNewRoleForm({ ...newRoleForm, description: e.target.value })}
                          required
                          rows="2"
                        />
                      </div>
                    </div>

                    <div className="admin-form-row">
                      <div className="admin-form-group full">
                        <label>Select Badges for This Role *</label>
                        <div className="badges-checkbox-list">
                          {onChainBadges.map((badge) => (
                            <label key={badge.id} className="admin-checkbox">
                              <input
                                type="checkbox"
                                checked={newRoleForm.badgeIds.includes(badge.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setNewRoleForm({
                                      ...newRoleForm,
                                      badgeIds: [...newRoleForm.badgeIds, badge.id],
                                    });
                                  } else {
                                    setNewRoleForm({
                                      ...newRoleForm,
                                      badgeIds: newRoleForm.badgeIds.filter((id) => id !== badge.id),
                                    });
                                  }
                                }}
                              />
                              <span>{badge.name}</span>
                            </label>
                          ))}
                        </div>
                        {onChainBadges.length === 0 && <p className="help-text">No badges available yet</p>}
                      </div>
                    </div>

                    <div className="admin-form-actions">
                      <button type="submit" className="admin-btn admin-btn-primary">
                        ➕ Create Role
                      </button>
                    </div>
                  </form>
                </div>

                <div className="admin-list-section">
                  <h2>Existing Roles</h2>
                  {badgeRoles.length === 0 ? (
                    <div className="admin-empty-state">No roles created yet</div>
                  ) : (
                    <div className="admin-list">
                      {badgeRoles.map((role) => (
                        <div key={role.id} className="admin-list-item">
                          <div className="admin-item-header">
                            <strong>{role.name}</strong>
                          </div>
                          <div className="admin-item-details">
                            <p>{role.description}</p>
                            <p><span>Badges:</span> {role.badgeIds.length} badge(s)</p>
                            <p className="admin-item-date">Created {new Date(role.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Check Eligibility Tab */}
            {badgeSubTab === 'eligibility' && (
              <div className="badge-tab-content">
                <div className="admin-form-section">
                  <h2>Check User Eligibility</h2>
                  <p className="section-description">Verify if a user qualifies for activity and longevity badges</p>
                  
                  <form onSubmit={(e) => { e.preventDefault(); handleCheckEligibility(); }} className="admin-form">
                    <div className="admin-form-row">
                      <div className="admin-form-group">
                        <label htmlFor="check-address">Wallet Address *</label>
                        <input
                          id="check-address"
                          type="text"
                          placeholder="0x..."
                          value={eligibilityCheckAddress}
                          onChange={(e) => setEligibilityCheckAddress(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="admin-form-actions">
                      <button
                        type="submit"
                        className="admin-btn admin-btn-primary"
                        disabled={checkingEligibility}
                      >
                        {checkingEligibility ? '⏳ Checking...' : '✅ Check Eligibility'}
                      </button>
                    </div>
                  </form>

                  {eligibilityReport && (
                    <div className="eligibility-report">
                      <h3>Eligibility Report</h3>
                      <div className="report-stats">
                        <div className="stat">
                          <strong>Transactions</strong>
                          <span className="stat-value">{eligibilityReport.transactionCount}</span>
                        </div>
                        <div className="stat">
                          <strong>Days Onchain</strong>
                          <span className="stat-value">{eligibilityReport.daysOnchain}</span>
                        </div>
                        {eligibilityReport.firstTransactionDate && (
                          <div className="stat">
                            <strong>First Transaction</strong>
                            <span className="stat-value">{eligibilityReport.firstTransactionDate.toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>

                      <h4>Activity Badge Eligibility</h4>
                      <div className="eligibility-badges">
                        {ACTIVITY_BADGE_TIERS.map((tier) => {
                          const eligible = eligibilityReport.transactionCount >= tier.count;
                          return (
                            <div key={tier.count} className={`eligibility-badge ${eligible ? 'eligible' : ''}`}>
                              <span className="badge-emoji">{tier.emoji}</span>
                              <span className="badge-name">{tier.name}</span>
                              <span className="badge-requirement">({tier.count}+)</span>
                              <span className={`badge-status ${eligible ? 'success' : 'pending'}`}>
                                {eligible ? '✓ Eligible' : '✗ Not Yet'}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <h4>Longevity Badge Eligibility</h4>
                      <div className="eligibility-badges">
                        {LONGEVITY_BADGE_TIERS.map((tier) => {
                          const eligible = eligibilityReport.daysOnchain >= tier.days;
                          return (
                            <div key={tier.days} className={`eligibility-badge ${eligible ? 'eligible' : ''}`}>
                              <span className="badge-emoji">{tier.emoji}</span>
                              <span className="badge-name">{tier.name}</span>
                              <span className="badge-requirement">({tier.days}d)</span>
                              <span className={`badge-status ${eligible ? 'success' : 'pending'}`}>
                                {eligible ? '✓ Eligible' : '✗ Not Yet'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="admin-content">
            <div className="admin-settings-section">
              <h2>Data Management</h2>
              <p>Export, import, or clear all administrative data</p>

              <div className="admin-settings-grid">
                <div className="admin-settings-card">
                  <h3>📥 Export Data</h3>
                  <p>Download all custom tokens and badges as a JSON file</p>
                  <button className="admin-btn admin-btn-primary" onClick={handleExportData}>
                    📥 Export Data
                  </button>
                </div>

                <div className="admin-settings-card">
                  <h3>📤 Import Data</h3>
                  <p>Restore tokens and badges from a JSON file</p>
                  <label className="admin-btn admin-btn-primary">
                    📤 Import Data
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportData}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>

                <div className="admin-settings-card danger">
                  <h3>🗑️ Clear All Data</h3>
                  <p>Delete all custom tokens and badges permanently</p>
                  <button
                    className="admin-btn admin-btn-danger"
                    onClick={handleClearAllData}
                  >
                    🗑️ Clear All Data
                  </button>
                </div>
              </div>

              <div className="admin-info-section">
                <h3>📊 Statistics</h3>
                <div className="admin-stats">
                  <div className="admin-stat">
                    <span className="admin-stat-label">Custom Tokens</span>
                    <span className="admin-stat-value">{customTokens.length}</span>
                  </div>
                  <div className="admin-stat">
                    <span className="admin-stat-label">Custom Badges</span>
                    <span className="admin-stat-value">{onChainBadges.length}</span>
                  </div>
                  <div className="admin-stat">
                    <span className="admin-stat-label">Total Items</span>
                    <span className="admin-stat-value">{customTokens.length + onChainBadges.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
