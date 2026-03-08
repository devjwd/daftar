/**
 * BadgeAdmin Component
 * 
 * Full admin panel for managing SBT badges:
 * - Create/edit/delete badge definitions
 * - Configure eligibility criteria with dynamic forms
 * - Preview badges
 * - Import/export badge configs
 * - Quick-create from templates (activity/longevity tiers)
 */
import React, { useState, useCallback, useMemo } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import useBadgeStore from '../hooks/useBadgeStore.js';
import { getCriteriaMetadata } from '../services/badges/criteria/index.js';
import {
  BADGE_CATEGORIES,
  BADGE_RARITY,
  CRITERIA_TYPES,
  CRITERIA_PARAM_SCHEMAS,
  CRITERIA_LABELS,
  ACTIVITY_BADGE_TIERS,
  LONGEVITY_BADGE_TIERS,
  getRarityInfo,
  BADGE_RULES,
} from '../config/badges.js';
import { DEFAULT_NETWORK } from '../config/network.js';
import {
  addAllowlistEntries,
  buildMetadataDataUri,
  buildMetadataJson,
  computeSha256Hex,
  createBadgeAllowlist,
  createBadgeMinBalance,
  createBadgeProtocolCount,
  createBadgeTxCount,
  fetchBadgeIds,
} from '../services/badgeService.js';
import { DEFI_PROTOCOLS } from '../config/protocols.js';
import './BadgeAdmin.css';

const EMPTY_CRITERION = { type: '', params: {} };

const EMPTY_FORM = {
  name: '',
  description: '',
  imageUrl: '',
  category: 'activity',
  rarity: 'COMMON',
  xp: 10,
  criteria: [{ ...EMPTY_CRITERION }],
  metadata: { externalUrl: '', attributes: [] },
  enabled: true,
};

export default function BadgeAdmin() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const {
    badges,
    createBadge,
    updateBadge,
    deleteBadge,
    toggleBadge,
    importBadges,
    exportBadges,
    clearAll,
  } = useBadgeStore();

  const [form, setForm] = useState({ ...EMPTY_FORM, criteria: [{ ...EMPTY_CRITERION }] });
  const [editingId, setEditingId] = useState(null);
  const [subTab, setSubTab] = useState('manage'); // 'manage', 'create', 'templates', 'import'
  const [message, setMessage] = useState({ type: '', text: '' });
  const [importText, setImportText] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const movementClient = useMemo(
    () => new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: DEFAULT_NETWORK.rpc })),
    []
  );

  const criteriaOptions = useMemo(() => getCriteriaMetadata(), []);

  // Protocol options for protocol_usage criteria
  const protocolOptions = useMemo(() =>
    Object.entries(DEFI_PROTOCOLS).map(([key, p]) => ({ value: key, label: p.name })),
    []
  );

  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 4000);
  }, []);

  // ─── Form Handlers ──────────────────────────────────────────────────
  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const updateCriterion = (index, field, value) => {
    setForm(prev => {
      const criteria = [...prev.criteria];
      if (field === 'type') {
        // Reset params when type changes
        criteria[index] = { type: value, params: {} };
      } else {
        criteria[index] = {
          ...criteria[index],
          params: { ...criteria[index].params, [field]: value },
        };
      }
      return { ...prev, criteria };
    });
  };

  const addCriterion = () => {
    setForm(prev => ({
      ...prev,
      criteria: [...prev.criteria, { ...EMPTY_CRITERION }],
    }));
  };

  const removeCriterion = (index) => {
    setForm(prev => ({
      ...prev,
      criteria: prev.criteria.filter((_, i) => i !== index),
    }));
  };

  const handleImageUrlChange = (url) => {
    updateForm('imageUrl', url);
    setImagePreview(url);
  };

  // ─── CRUD Actions ───────────────────────────────────────────────────
  const createMintableSBTBadge = useCallback(async (badgeData) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      throw new Error('Connect admin wallet to create mintable SBT badges');
    }

    const sender = typeof account.address === 'string' ? account.address : account.address.toString();
    const firstCriterion = badgeData.criteria?.[0] || null;

    const metadataJson = buildMetadataJson({
      name: badgeData.name,
      description: badgeData.description,
      imageUri: badgeData.imageUrl,
      attributes: [
        { trait_type: 'category', value: badgeData.category },
        { trait_type: 'rarity', value: badgeData.rarity },
        { trait_type: 'xp', value: String(badgeData.xp) },
      ],
    });
    const metadataUri = buildMetadataDataUri(metadataJson);
    const metadataHash = await computeSha256Hex(metadataJson);

    const beforeIds = await fetchBadgeIds(movementClient);

    if (firstCriterion?.type === CRITERIA_TYPES.MIN_BALANCE) {
      const decimals = Number(firstCriterion.params?.decimals ?? 8);
      const minAmountHuman = Number(firstCriterion.params?.minAmount ?? 0);
      const minBalance = Math.max(0, Math.floor(minAmountHuman * Math.pow(10, decimals)));
      const coinType = String(firstCriterion.params?.coinType || '').trim();

      if (!coinType) {
        throw new Error('Min Balance criterion requires coin type');
      }

      await createBadgeMinBalance({
        signAndSubmitTransaction,
        sender,
        name: badgeData.name,
        description: badgeData.description,
        imageUri: badgeData.imageUrl,
        metadataUri,
        metadataHash,
        coinType,
        coinTypeStr: coinType,
        minBalance,
        ruleNote: `min_balance:${minAmountHuman}`,
      });
    } else if (firstCriterion?.type === CRITERIA_TYPES.TRANSACTION_COUNT) {
      const minTxCount = Math.max(1, Number(firstCriterion.params?.min ?? 1));
      await createBadgeTxCount({
        signAndSubmitTransaction,
        sender,
        name: badgeData.name,
        description: badgeData.description,
        imageUri: badgeData.imageUrl,
        metadataUri,
        metadataHash,
        minTxCount,
        ruleNote: `tx_count:${minTxCount}`,
      });
    } else if (firstCriterion?.type === CRITERIA_TYPES.PROTOCOL_COUNT) {
      const minProtocolCount = Math.max(1, Number(firstCriterion.params?.minProtocols ?? 1));
      await createBadgeProtocolCount({
        signAndSubmitTransaction,
        sender,
        name: badgeData.name,
        description: badgeData.description,
        imageUri: badgeData.imageUrl,
        metadataUri,
        metadataHash,
        minProtocolCount,
        ruleNote: `protocol_count:${minProtocolCount}`,
      });
    } else {
      const ruleTypeMap = {
        [CRITERIA_TYPES.ALLOWLIST]: BADGE_RULES.ALLOWLIST,
      };

      const ruleType = ruleTypeMap[firstCriterion?.type] || BADGE_RULES.OFFCHAIN_ALLOWLIST;
      const ruleNote = firstCriterion?.type
        ? `${firstCriterion.type}:${JSON.stringify(firstCriterion.params || {})}`
        : 'offchain';

      await createBadgeAllowlist({
        signAndSubmitTransaction,
        sender,
        name: badgeData.name,
        description: badgeData.description,
        imageUri: badgeData.imageUrl,
        metadataUri,
        metadataHash,
        ruleType,
        ruleNote,
      });
    }

    const afterIds = await fetchBadgeIds(movementClient);
    const beforeSet = new Set((beforeIds || []).map((id) => Number(id)));
    const onChainBadgeId = (afterIds || []).map((id) => Number(id)).find((id) => !beforeSet.has(id));

    if (onChainBadgeId == null) {
      throw new Error('On-chain badge was created but ID lookup failed. Refresh and retry.');
    }

    if (firstCriterion?.type === CRITERIA_TYPES.ALLOWLIST) {
      const addresses = String(firstCriterion.params?.addresses || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (addresses.length > 0) {
        await addAllowlistEntries({
          signAndSubmitTransaction,
          sender,
          badgeId: onChainBadgeId,
          addresses,
        });
      }
    }

    return onChainBadgeId;
  }, [connected, account, signAndSubmitTransaction, movementClient]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const badgeData = {
      ...form,
      xp: Number(form.xp) || 10,
    };

    setSubmitting(true);

    let result;
    if (editingId) {
      result = updateBadge(editingId, badgeData);
    } else {
      try {
        const onChainBadgeId = await createMintableSBTBadge(badgeData);
        result = createBadge({ ...badgeData, onChainBadgeId });
      } catch (error) {
        showMessage('error', error?.message || 'Failed to create on-chain SBT badge');
        setSubmitting(false);
        return;
      }
    }

    if (result.success) {
      showMessage('success', editingId ? 'Badge updated successfully' : 'Badge created successfully');
      resetForm();
      setSubTab('manage');
    } else {
      showMessage('error', result.errors?.join(', ') || 'Operation failed');
    }
    setSubmitting(false);
  };

  const handleEdit = (badge) => {
    setForm({
      name: badge.name,
      description: badge.description,
      imageUrl: badge.imageUrl,
      category: badge.category,
      rarity: badge.rarity,
      xp: badge.xp,
      criteria: badge.criteria.length > 0 ? badge.criteria : [{ ...EMPTY_CRITERION }],
      metadata: badge.metadata || { externalUrl: '', attributes: [] },
      enabled: badge.enabled,
    });
    setEditingId(badge.id);
    setImagePreview(badge.imageUrl);
    setSubTab('create');
  };

  const handleDelete = (id) => {
    const result = deleteBadge(id);
    if (result.success) {
      showMessage('success', 'Badge deleted');
      setDeleteConfirm(null);
    }
  };

  const handleToggle = (id) => {
    toggleBadge(id);
  };

  const resetForm = () => {
    setForm({ ...EMPTY_FORM, criteria: [{ ...EMPTY_CRITERION }] });
    setEditingId(null);
    setImagePreview('');
  };

  // ─── Template Quick-Create ──────────────────────────────────────────
  const createFromActivityTier = async (tier) => {
    setSubmitting(true);
    const payload = {
      name: tier.name,
      description: tier.description,
      imageUrl: 'https://placehold.co/512x512/png',
      category: 'activity',
      rarity: tier.rarity,
      xp: tier.xp,
      criteria: [{ type: CRITERIA_TYPES.TRANSACTION_COUNT, params: { min: tier.count } }],
    };

    try {
      const onChainBadgeId = await createMintableSBTBadge(payload);
      const result = createBadge({ ...payload, onChainBadgeId });
      if (result.success) showMessage('success', `Created "${tier.name}" badge`);
      else showMessage('error', result.errors?.join(', '));
    } catch (error) {
      showMessage('error', error?.message || 'Failed to create on-chain SBT badge');
    }
    setSubmitting(false);
  };

  const createFromLongevityTier = async (tier) => {
    setSubmitting(true);
    const payload = {
      name: tier.name,
      description: tier.description,
      imageUrl: 'https://placehold.co/512x512/png',
      category: 'longevity',
      rarity: tier.rarity,
      xp: tier.xp,
      criteria: [{ type: CRITERIA_TYPES.DAYS_ONCHAIN, params: { min: tier.days } }],
    };

    try {
      const onChainBadgeId = await createMintableSBTBadge(payload);
      const result = createBadge({ ...payload, onChainBadgeId });
      if (result.success) showMessage('success', `Created "${tier.name}" badge`);
      else showMessage('error', result.errors?.join(', '));
    } catch (error) {
      showMessage('error', error?.message || 'Failed to create on-chain SBT badge');
    }
    setSubmitting(false);
  };

  // ─── Import/Export ──────────────────────────────────────────────────
  const handleImport = () => {
    try {
      const data = JSON.parse(importText);
      const result = importBadges(data);
      showMessage(
        result.imported > 0 ? 'success' : 'error',
        `Imported ${result.imported}, skipped ${result.skipped}. ${result.errors.length > 0 ? result.errors[0] : ''}`
      );
      setImportText('');
    } catch {
      showMessage('error', 'Invalid JSON format');
    }
  };

  const handleExport = () => {
    const json = exportBadges();
    navigator.clipboard.writeText(json).then(() => {
      showMessage('success', 'Badge config copied to clipboard');
    }).catch(() => {
      // Fallback: trigger download
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'badges-export.json';
      a.click();
      URL.revokeObjectURL(url);
      showMessage('success', 'Badge config downloaded');
    });
  };

  // ─── Render Criteria Form ───────────────────────────────────────────
  const renderCriterionForm = (criterion, index) => {
    const schema = CRITERIA_PARAM_SCHEMAS[criterion.type] || {};

    return (
      <div key={index} className="ba-criterion-block">
        <div className="ba-criterion-header">
          <span className="ba-criterion-num">Criterion {index + 1}</span>
          {form.criteria.length > 1 && (
            <button type="button" className="ba-btn-icon ba-btn-remove" onClick={() => removeCriterion(index)} title="Remove">
              &times;
            </button>
          )}
        </div>

        <div className="ba-field">
          <label>Criteria Type</label>
          <select
            value={criterion.type}
            onChange={(e) => updateCriterion(index, 'type', e.target.value)}
            className="ba-select"
          >
            <option value="">Select criteria type...</option>
            {criteriaOptions.map(opt => (
              <option key={opt.type} value={opt.type}>
                {opt.icon} {opt.name} — {opt.description}
              </option>
            ))}
          </select>
        </div>

        {criterion.type && Object.entries(schema).map(([paramKey, paramDef]) => (
          <div key={paramKey} className="ba-field">
            <label>{paramDef.label}{paramDef.required && <span className="ba-required">*</span>}</label>
            {paramDef.type === 'textarea' ? (
              <textarea
                value={criterion.params[paramKey] || ''}
                onChange={(e) => updateCriterion(index, paramKey, e.target.value)}
                placeholder={paramDef.placeholder || ''}
                className="ba-textarea"
                rows={4}
              />
            ) : paramDef.type === 'select' ? (
              <select
                value={criterion.params[paramKey] || ''}
                onChange={(e) => updateCriterion(index, paramKey, e.target.value)}
                className="ba-select"
              >
                <option value="">Select...</option>
                {(paramKey === 'protocolKey' ? protocolOptions : paramDef.options || []).map(opt => (
                  <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>
                ))}
              </select>
            ) : (
              <input
                type={paramDef.type === 'number' ? 'number' : 'text'}
                value={criterion.params[paramKey] ?? paramDef.default ?? ''}
                onChange={(e) => updateCriterion(index, paramKey, paramDef.type === 'number' ? Number(e.target.value) : e.target.value)}
                placeholder={paramDef.placeholder || ''}
                min={paramDef.min}
                max={paramDef.max}
                className="ba-input"
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="ba-container">
      {/* Message bar */}
      {message.text && (
        <div className={`ba-message ba-message-${message.type}`}>
          {message.type === 'success' ? '✓' : '⚠'} {message.text}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="ba-subtabs">
        {[
          { key: 'manage', label: 'Manage Badges', icon: '📋' },
          { key: 'create', label: editingId ? 'Edit Badge' : 'Create Badge', icon: '➕' },
          { key: 'templates', label: 'Templates', icon: '⚡' },
          { key: 'import', label: 'Import / Export', icon: '📦' },
        ].map(tab => (
          <button
            key={tab.key}
            className={`ba-subtab ${subTab === tab.key ? 'active' : ''}`}
            onClick={() => { setSubTab(tab.key); if (tab.key !== 'create') resetForm(); }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Manage Tab ────────────────────────────────────────────── */}
      {subTab === 'manage' && (
        <div className="ba-manage">
          <div className="ba-manage-header">
            <h3>{badges.length} Badge{badges.length !== 1 ? 's' : ''} Defined</h3>
            <div className="ba-manage-actions">
              <button className="ba-btn ba-btn-primary" onClick={() => setSubTab('create')}>
                + New Badge
              </button>
            </div>
          </div>

          {badges.length === 0 ? (
            <div className="ba-empty">
              <p>No badges defined yet. Create your first badge or use a template.</p>
            </div>
          ) : (
            <div className="ba-badge-list">
              {badges.map(badge => {
                const rarity = getRarityInfo(badge.rarity);
                return (
                  <div key={badge.id} className={`ba-badge-item ${!badge.enabled ? 'disabled' : ''}`}>
                    <div className="ba-badge-preview">
                      {badge.imageUrl ? (
                        <img src={badge.imageUrl} alt={badge.name} className="ba-badge-thumb" />
                      ) : (
                        <div className="ba-badge-placeholder" style={{ borderColor: rarity.color }}>
                          {badge.category === 'activity' ? '⚡' : badge.category === 'longevity' ? '🕐' : '🏆'}
                        </div>
                      )}
                    </div>
                    <div className="ba-badge-info">
                      <div className="ba-badge-title-row">
                        <h4>{badge.name}</h4>
                        <span className="ba-rarity-pill" style={{ background: rarity.color }}>{rarity.name}</span>
                        <span className="ba-xp-pill">+{badge.xp} XP</span>
                      </div>
                      <p className="ba-badge-desc">{badge.description}</p>
                      <div className="ba-badge-criteria-tags">
                        {badge.criteria.map((c, i) => (
                          <span key={i} className="ba-criteria-tag">
                            {CRITERIA_LABELS[c.type] || c.type}
                          </span>
                        ))}
                        <span className="ba-category-tag">{
                          Object.values(BADGE_CATEGORIES).find(cat => cat.id === badge.category)?.icon
                        } {badge.category}</span>
                      </div>
                    </div>
                    <div className="ba-badge-actions">
                      <button className="ba-btn-icon" onClick={() => handleToggle(badge.id)} title={badge.enabled ? 'Disable' : 'Enable'}>
                        {badge.enabled ? '🟢' : '🔴'}
                      </button>
                      <button className="ba-btn-icon" onClick={() => handleEdit(badge)} title="Edit">
                        ✏️
                      </button>
                      {deleteConfirm === badge.id ? (
                        <div className="ba-delete-confirm">
                          <button className="ba-btn ba-btn-danger ba-btn-sm" onClick={() => handleDelete(badge.id)}>Confirm</button>
                          <button className="ba-btn ba-btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="ba-btn-icon" onClick={() => setDeleteConfirm(badge.id)} title="Delete">
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Create / Edit Tab ─────────────────────────────────────── */}
      {subTab === 'create' && (
        <form className="ba-form" onSubmit={handleSubmit}>
          <div className="ba-form-grid">
            {/* Left column: basic info */}
            <div className="ba-form-left">
              <h3>{editingId ? 'Edit Badge' : 'Create New Badge'}</h3>

              <div className="ba-field">
                <label>Badge Name<span className="ba-required">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateForm('name', e.target.value)}
                  placeholder="e.g. Power Trader"
                  className="ba-input"
                  maxLength={100}
                  required
                />
              </div>

              <div className="ba-field">
                <label>Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm('description', e.target.value)}
                  placeholder="What this badge represents..."
                  className="ba-textarea"
                  rows={3}
                />
              </div>

              <div className="ba-field">
                <label>Image URL<span className="ba-required">*</span></label>
                <input
                  type="url"
                  value={form.imageUrl}
                  onChange={(e) => handleImageUrlChange(e.target.value)}
                  placeholder="https://example.com/badge.png"
                  className="ba-input"
                  required
                />
                {imagePreview && (
                  <div className="ba-image-preview">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      onError={(e) => { e.target.style.display = 'none'; }}
                      onLoad={(e) => { e.target.style.display = 'block'; }}
                    />
                  </div>
                )}
              </div>

              <div className="ba-field-row">
                <div className="ba-field">
                  <label>Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => updateForm('category', e.target.value)}
                    className="ba-select"
                  >
                    {Object.values(BADGE_CATEGORIES).map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                    ))}
                  </select>
                </div>

                <div className="ba-field">
                  <label>Rarity</label>
                  <select
                    value={form.rarity}
                    onChange={(e) => updateForm('rarity', e.target.value)}
                    className="ba-select"
                  >
                    {Object.entries(BADGE_RARITY).map(([key, r]) => (
                      <option key={key} value={key}>{r.name} (Level {r.level})</option>
                    ))}
                  </select>
                </div>

                <div className="ba-field">
                  <label>XP Reward</label>
                  <input
                    type="number"
                    value={form.xp}
                    onChange={(e) => updateForm('xp', Number(e.target.value))}
                    min={0}
                    max={1000}
                    className="ba-input"
                  />
                </div>
              </div>

              <div className="ba-field">
                <label>External URL (optional)</label>
                <input
                  type="url"
                  value={form.metadata.externalUrl}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    metadata: { ...prev.metadata, externalUrl: e.target.value }
                  }))}
                  placeholder="https://..."
                  className="ba-input"
                />
              </div>

              <div className="ba-field-toggle">
                <label className="ba-toggle-label">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => updateForm('enabled', e.target.checked)}
                  />
                  <span>Enabled (visible to users)</span>
                </label>
              </div>
            </div>

            {/* Right column: eligibility criteria */}
            <div className="ba-form-right">
              <h3>Eligibility Criteria</h3>
              <p className="ba-hint">All criteria must be met (AND logic). Add multiple criteria for complex requirements.</p>

              {form.criteria.map((criterion, i) => renderCriterionForm(criterion, i))}

              <button
                type="button"
                className="ba-btn ba-btn-secondary ba-btn-add-criterion"
                onClick={addCriterion}
              >
                + Add Another Criterion
              </button>
            </div>
          </div>

          {/* Form actions */}
          <div className="ba-form-actions">
            <button type="submit" className="ba-btn ba-btn-primary" disabled={submitting}>
              {submitting ? 'Creating SBT...' : editingId ? 'Update Badge' : 'Create Badge'}
            </button>
            <button type="button" className="ba-btn ba-btn-secondary" onClick={resetForm}>
              {editingId ? 'Cancel Edit' : 'Reset'}
            </button>
          </div>
        </form>
      )}

      {/* ─── Templates Tab ─────────────────────────────────────────── */}
      {subTab === 'templates' && (
        <div className="ba-templates">
          <div className="ba-template-section">
            <h3>Activity Badge Templates</h3>
            <p className="ba-hint">One-click create badges based on transaction count milestones.</p>
            <div className="ba-template-grid">
              {ACTIVITY_BADGE_TIERS.map((tier, i) => {
                const rarity = getRarityInfo(tier.rarity);
                const exists = badges.some(b => b.name === tier.name);
                return (
                  <div key={i} className={`ba-template-card ${exists ? 'exists' : ''}`}>
                    <div className="ba-template-emoji">{tier.emoji}</div>
                    <h4>{tier.name}</h4>
                    <p>{tier.description}</p>
                    <div className="ba-template-meta">
                      <span className="ba-rarity-pill" style={{ background: rarity.color }}>{rarity.name}</span>
                      <span className="ba-xp-pill">+{tier.xp} XP</span>
                    </div>
                    <button
                      className="ba-btn ba-btn-primary ba-btn-sm"
                      onClick={() => createFromActivityTier(tier)}
                      disabled={exists || submitting}
                    >
                      {exists ? 'Already exists' : submitting ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ba-template-section">
            <h3>Longevity Badge Templates</h3>
            <p className="ba-hint">One-click create badges based on days on-chain.</p>
            <div className="ba-template-grid">
              {LONGEVITY_BADGE_TIERS.map((tier, i) => {
                const rarity = getRarityInfo(tier.rarity);
                const exists = badges.some(b => b.name === tier.name);
                return (
                  <div key={i} className={`ba-template-card ${exists ? 'exists' : ''}`}>
                    <div className="ba-template-emoji">{tier.emoji}</div>
                    <h4>{tier.name}</h4>
                    <p>{tier.description}</p>
                    <div className="ba-template-meta">
                      <span className="ba-rarity-pill" style={{ background: rarity.color }}>{rarity.name}</span>
                      <span className="ba-xp-pill">+{tier.xp} XP</span>
                    </div>
                    <button
                      className="ba-btn ba-btn-primary ba-btn-sm"
                      onClick={() => createFromLongevityTier(tier)}
                      disabled={exists || submitting}
                    >
                      {exists ? 'Already exists' : submitting ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Import / Export Tab ────────────────────────────────────── */}
      {subTab === 'import' && (
        <div className="ba-import-export">
          <div className="ba-ie-section">
            <h3>Export Badges</h3>
            <p className="ba-hint">Export all badge definitions as JSON. Copy to clipboard or download.</p>
            <button className="ba-btn ba-btn-primary" onClick={handleExport}>
              Export All Badges ({badges.length})
            </button>
          </div>

          <div className="ba-ie-section">
            <h3>Import Badges</h3>
            <p className="ba-hint">Paste badge definitions JSON to import. Duplicates (by name) will be skipped.</p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='[{"name": "Badge Name", "description": "...", "imageUrl": "https://...", "criteria": [...]}]'
              className="ba-textarea ba-import-textarea"
              rows={8}
            />
            <button
              className="ba-btn ba-btn-primary"
              onClick={handleImport}
              disabled={!importText.trim()}
            >
              Import
            </button>
          </div>

          <div className="ba-ie-section ba-danger-zone">
            <h3>Danger Zone</h3>
            <p className="ba-hint">Clear all badge definitions and awards. This cannot be undone.</p>
            <button
              className="ba-btn ba-btn-danger"
              onClick={() => {
                if (window.confirm('Delete ALL badge definitions and awards? This cannot be undone.')) {
                  clearAll();
                  showMessage('success', 'All badge data cleared');
                }
              }}
            >
              Clear All Badge Data
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
