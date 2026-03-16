/**
 * BadgeAdmin Component
 * 
 * Full admin panel for managing SBT badges:
 * - Create/edit/delete badge definitions
 * - Configure eligibility criteria with dynamic forms
 * - Pause/resume/discontinue badges on-chain
 * - Time-limited badge support
 * - Max supply limits
 * - Preview badges
 * - Import/export badge configs
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import useBadgeStore from '../hooks/useBadgeStore.js';
import { getCriteriaMetadata } from '../services/badges/criteria/index.js';
import {
  BADGE_CATEGORIES,
  BADGE_RARITY,
  BADGE_STATUS,
  BADGE_STATUS_LABELS,
  BADGE_STATUS_COLORS,
  CRITERIA_TYPES,
  CRITERIA_PARAM_SCHEMAS,
  CRITERIA_LABELS,
  getRarityInfo,
  BADGE_RULES,
  criteriaToRuleType,
} from '../config/badges.js';
import { DEFAULT_NETWORK } from '../config/network.js';
import {
  addAllowlistEntries,
  buildMetadataDataUri,
  buildMetadataJson,
  computeSha256Hex,
  createBadge as createOnChainBadge,
  fetchBadgeIds,
  fetchBadges as fetchOnChainBadges,
  pauseBadge as pauseOnChainBadge,
  resumeBadge as resumeOnChainBadge,
  discontinueBadge as discontinueOnChainBadge,
  updateBadgeTimeLimits,
  getBadgeStats,
  isBadgeMintable,
  getBadgeTimeRemaining,
  getBadgeSupplyInfo,
} from '../services/badgeService.js';
import { publishScannerConfigs } from '../services/badgeApi.js';
import { DEFI_PROTOCOLS } from '../config/protocols.js';
import './BadgeAdmin.css';

const EMPTY_CRITERION = { type: '', params: {} };

const EMPTY_SPECIAL_SETTINGS = {
  isSpecial: false,
  timeLimited: {
    enabled: false,
    startsAt: '',
    endsAt: '',
    note: '',
  },
  reward: {
    enabled: false,
    winnerLimit: 100,
    rewardTitle: '',
    rewardDetails: '',
    rewardType: '',
    rewardValue: '',
    distributionDate: '',
  },
  maxSupply: 0, // 0 = unlimited
};

const buildSpecialSettings = (input = {}) => ({
  isSpecial: Boolean(input.isSpecial || input.timeLimited?.enabled || input.reward?.enabled),
  timeLimited: {
    ...EMPTY_SPECIAL_SETTINGS.timeLimited,
    ...(input.timeLimited || {}),
  },
  reward: {
    ...EMPTY_SPECIAL_SETTINGS.reward,
    ...(input.reward || {}),
  },
  maxSupply: Number(input.maxSupply) || 0,
});

// Convert datetime-local string to Unix timestamp (seconds)
const datetimeToUnix = (datetime) => {
  if (!datetime) return 0;
  const date = new Date(datetime);
  return Math.floor(date.getTime() / 1000);
};

// Convert Unix timestamp to datetime-local string
const unixToDatetime = (unix) => {
  if (!unix || unix === 0) return '';
  const date = new Date(unix * 1000);
  return date.toISOString().slice(0, 16);
};

const EMPTY_FORM = {
  name: '',
  description: '',
  imageUrl: '',
  category: 'activity',
  rarity: 'COMMON',
  xp: 10,
  mintFeePreset: 'free',
  mintFeeMove: '0',
  criteria: [{ ...EMPTY_CRITERION }],
  metadata: { externalUrl: '', attributes: [] },
  enabled: true,
};

const OCTAS_PER_MOVE = 100_000_000;

const resolveMintFeePreset = (mintFeeOctas = 0) => {
  if (mintFeeOctas === 0) return 'free';
  if (mintFeeOctas === OCTAS_PER_MOVE) return '1';
  if (mintFeeOctas === OCTAS_PER_MOVE * 2) return '2';
  return 'custom';
};

const formatMoveAmount = (mintFeeOctas = 0) => {
  const moveAmount = Number(mintFeeOctas || 0) / OCTAS_PER_MOVE;
  return Number.isInteger(moveAmount) ? String(moveAmount) : moveAmount.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
};

const parseMintFeeToOctas = (mintFeeMove) => {
  const moveAmount = Number(mintFeeMove);
  if (!Number.isFinite(moveAmount) || moveAmount <= 0) return 0;
  return Math.round(moveAmount * OCTAS_PER_MOVE);
};

const ONCHAIN_SUPPORTED_CRITERIA = new Set([
  CRITERIA_TYPES.MIN_BALANCE,
  CRITERIA_TYPES.TRANSACTION_COUNT,
  CRITERIA_TYPES.PROTOCOL_COUNT,
  CRITERIA_TYPES.ALLOWLIST,
]);

export default function BadgeAdmin() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const {
    badges,
    createBadge,
    deleteBadge,
    toggleBadge,
    importBadges,
    exportBadges,
    exportScannerConfigs,
    clearAll,
  } = useBadgeStore();

  const [form, setForm] = useState({
    ...EMPTY_FORM,
    criteria: [{ ...EMPTY_CRITERION }],
    metadata: {
      ...EMPTY_FORM.metadata,
      special: buildSpecialSettings(),
    },
  });
  const [editingId, setEditingId] = useState(null);
  const [subTab, setSubTab] = useState('manage'); // 'manage', 'create', 'import', 'onchain'
  const [message, setMessage] = useState({ type: '', text: '' });
  const [importText, setImportText] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // On-chain badge management state
  const [onChainBadges, setOnChainBadges] = useState([]);
  const [onChainLoading, setOnChainLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // badgeId currently being acted on

  const movementClient = useMemo(
    () => new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: DEFAULT_NETWORK.rpc })),
    []
  );

  const criteriaOptions = useMemo(() => getCriteriaMetadata(), []);

  const previewRarity = useMemo(() => getRarityInfo(form.rarity || 'COMMON'), [form.rarity]);
  const previewIcon = useMemo(() => {
    if (form.category === 'activity') return '⚡';
    if (form.category === 'longevity') return '🕐';
    if (form.category === 'defi') return '🏦';
    if (form.category === 'community') return '🤝';
    if (form.category === 'special') return '✨';
    return '🏆';
  }, [form.category]);

  // Protocol options for protocol_usage criteria
  const protocolOptions = useMemo(() =>
    Object.entries(DEFI_PROTOCOLS).map(([key, p]) => ({ value: key, label: p.name })),
    []
  );

  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 4000);
  }, []);
  
  // ─── On-Chain Badge Loading ─────────────────────────────────────────
  const loadOnChainBadges = useCallback(async () => {
    setOnChainLoading(true);
    try {
      const badges = await fetchOnChainBadges(movementClient);
      setOnChainBadges(badges);
    } catch (err) {
      console.error('[BadgeAdmin] Failed to load on-chain badges', err);
      showMessage('error', 'Failed to load on-chain badges');
    } finally {
      setOnChainLoading(false);
    }
  }, [movementClient, showMessage]);

  // Load on-chain badges when switching to on-chain tab
  useEffect(() => {
    if (subTab === 'onchain') {
      loadOnChainBadges();
    }
  }, [subTab, loadOnChainBadges]);

  // ─── On-Chain Badge Actions ─────────────────────────────────────────
  const handlePauseBadge = useCallback(async (badgeId) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      showMessage('error', 'Connect admin wallet to pause badges');
      return;
    }
    
    setActionLoading(badgeId);
    try {
      const sender = typeof account.address === 'string' ? account.address : account.address.toString();
      await pauseOnChainBadge({ signAndSubmitTransaction, sender, badgeId });
      showMessage('success', `Badge #${badgeId} paused successfully`);
      await loadOnChainBadges();
    } catch (err) {
      showMessage('error', err?.message || 'Failed to pause badge');
    } finally {
      setActionLoading(null);
    }
  }, [connected, account, signAndSubmitTransaction, showMessage, loadOnChainBadges]);

  const handleResumeBadge = useCallback(async (badgeId) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      showMessage('error', 'Connect admin wallet to resume badges');
      return;
    }
    
    setActionLoading(badgeId);
    try {
      const sender = typeof account.address === 'string' ? account.address : account.address.toString();
      await resumeOnChainBadge({ signAndSubmitTransaction, sender, badgeId });
      showMessage('success', `Badge #${badgeId} resumed successfully`);
      await loadOnChainBadges();
    } catch (err) {
      showMessage('error', err?.message || 'Failed to resume badge');
    } finally {
      setActionLoading(null);
    }
  }, [connected, account, signAndSubmitTransaction, showMessage, loadOnChainBadges]);

  const handleDiscontinueBadge = useCallback(async (badgeId) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      showMessage('error', 'Connect admin wallet to discontinue badges');
      return;
    }
    
    if (!window.confirm(`Are you sure you want to PERMANENTLY discontinue Badge #${badgeId}? This cannot be undone.`)) {
      return;
    }
    
    setActionLoading(badgeId);
    try {
      const sender = typeof account.address === 'string' ? account.address : account.address.toString();
      await discontinueOnChainBadge({ signAndSubmitTransaction, sender, badgeId });
      showMessage('success', `Badge #${badgeId} discontinued permanently`);
      await loadOnChainBadges();
    } catch (err) {
      showMessage('error', err?.message || 'Failed to discontinue badge');
    } finally {
      setActionLoading(null);
    }
  }, [connected, account, signAndSubmitTransaction, showMessage, loadOnChainBadges]);

  // ─── Form Handlers ──────────────────────────────────────────────────
  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleMintFeePresetChange = (preset) => {
    setForm((prev) => ({
      ...prev,
      mintFeePreset: preset,
      mintFeeMove:
        preset === 'free'
          ? '0'
          : preset === '1'
            ? '1'
            : preset === '2'
              ? '2'
              : prev.mintFeeMove,
    }));
  };

  const updateSpecialSettings = (section, field, value) => {
    setForm((prev) => ({
      ...prev,
      metadata: {
        ...prev.metadata,
        special: {
          ...buildSpecialSettings(prev.metadata?.special || {}),
          [section]: {
            ...buildSpecialSettings(prev.metadata?.special || {})[section],
            [field]: value,
          },
        },
      },
    }));
  };

  const toggleSpecialBadge = (enabled) => {
    setForm((prev) => ({
      ...prev,
      category: enabled ? 'special' : prev.category,
      metadata: {
        ...prev.metadata,
        special: {
          ...buildSpecialSettings(prev.metadata?.special || {}),
          isSpecial: enabled,
        },
      },
    }));
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
      externalUrl: badgeData.metadata?.externalUrl,
      attributes: [
        { trait_type: 'category', value: badgeData.category },
        { trait_type: 'rarity', value: badgeData.rarity },
        { trait_type: 'xp', value: String(badgeData.xp) },
        { trait_type: 'mint_fee_move', value: formatMoveAmount(badgeData.mintFee) },
      ],
    });
    const metadataUri = buildMetadataDataUri(metadataJson);
    const metadataHash = await computeSha256Hex(metadataJson);

    const beforeIds = await fetchBadgeIds(movementClient);
    const specialSettings = buildSpecialSettings(badgeData.metadata?.special || {});
    const isTimeLimited = Boolean(specialSettings.timeLimited?.enabled);
    const startsAt = isTimeLimited ? datetimeToUnix(specialSettings.timeLimited?.startsAt) : 0;
    const endsAt = isTimeLimited ? datetimeToUnix(specialSettings.timeLimited?.endsAt) : 0;

    let minValue = 0;
    let coinTypeStr = '';

    if (firstCriterion?.type === CRITERIA_TYPES.MIN_BALANCE) {
      const decimals = Number(firstCriterion.params?.decimals ?? 8);
      const minAmountHuman = Number(firstCriterion.params?.minAmount ?? 0);
      minValue = Math.max(0, Math.floor(minAmountHuman * Math.pow(10, decimals)));
      coinTypeStr = String(firstCriterion.params?.coinType || '').trim();

      if (!coinTypeStr) {
        throw new Error('Min Balance criterion requires coin type');
      }
    } else if (firstCriterion?.type === CRITERIA_TYPES.TRANSACTION_COUNT) {
      minValue = Math.max(1, Number(firstCriterion.params?.min ?? 1));
    } else if (firstCriterion?.type === CRITERIA_TYPES.PROTOCOL_COUNT) {
      minValue = Math.max(1, Number(firstCriterion.params?.minProtocols ?? 1));
    }

    await createOnChainBadge({
      signAndSubmitTransaction,
      sender,
      name: badgeData.name,
      description: badgeData.description,
      imageUri: badgeData.imageUrl,
      metadataUri,
      metadataHash,
      category: badgeData.category,
      rarity: getRarityInfo(badgeData.rarity || 'COMMON').level,
      xpValue: Number(badgeData.xp) || 10,
      ruleType: criteriaToRuleType(firstCriterion?.type) || BADGE_RULES.OFFCHAIN_ALLOWLIST,
      ruleNote: firstCriterion?.type
        ? `${firstCriterion.type}:${JSON.stringify(firstCriterion.params || {})}`
        : 'offchain',
      minValue,
      coinTypeStr,
      dappAddress: '',
      extraData: firstCriterion?.type === CRITERIA_TYPES.ALLOWLIST ? 'allowlist' : '',
      startsAt,
      endsAt,
      maxSupply: Number(specialSettings.maxSupply) || 0,
      mintFee: Number(badgeData.mintFee) || 0,
    });

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

    const selectedCriteria = (form.criteria || []).filter((c) => c?.type);

    if (!editingId && selectedCriteria.length !== 1) {
      showMessage('error', 'Mintable SBT badges currently support exactly 1 on-chain criterion');
      return;
    }

    if (!editingId && selectedCriteria.length === 1 && !ONCHAIN_SUPPORTED_CRITERIA.has(selectedCriteria[0].type)) {
      showMessage('error', `Criterion "${selectedCriteria[0].type}" is not supported for on-chain minting yet`);
      return;
    }

    if (editingId && selectedCriteria.length > 1) {
      showMessage('error', 'Only 1 criterion is currently supported for badge definitions');
      return;
    }

    const badgeData = {
      ...form,
      xp: Number(form.xp) || 10,
      mintFee: parseMintFeeToOctas(form.mintFeeMove),
      metadata: {
        ...form.metadata,
        special: buildSpecialSettings(form.metadata?.special || {}),
      },
    };

    setSubmitting(true);

    let result;
    if (editingId) {
      showMessage('error', 'Editing existing badge definitions is disabled to prevent on-chain/off-chain mismatch. Create a new badge instead.');
      setSubmitting(false);
      return;
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
    const mintFee = Number(badge.mintFee) || 0;
    setForm({
      name: badge.name,
      description: badge.description,
      imageUrl: badge.imageUrl,
      category: badge.category,
      rarity: badge.rarity,
      xp: badge.xp,
      mintFeePreset: resolveMintFeePreset(mintFee),
      mintFeeMove: formatMoveAmount(mintFee),
      criteria: badge.criteria.length > 0 ? badge.criteria : [{ ...EMPTY_CRITERION }],
      metadata: {
        externalUrl: badge.metadata?.externalUrl || '',
        attributes: Array.isArray(badge.metadata?.attributes) ? badge.metadata.attributes : [],
        special: buildSpecialSettings(badge.metadata?.special || {}),
      },
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
    setForm({
      ...EMPTY_FORM,
      criteria: [{ ...EMPTY_CRITERION }],
      metadata: {
        ...EMPTY_FORM.metadata,
        special: buildSpecialSettings(),
      },
    });
    setEditingId(null);
    setImagePreview('');
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

  const handleExportScannerConfig = () => {
    const json = exportScannerConfigs();
    const parsed = (() => {
      try {
        return JSON.parse(json);
      } catch {
        return [];
      }
    })();

    const cachedKey = sessionStorage.getItem('badge_admin_api_key') || '';
    const enteredKey = window.prompt(
      'Publish scanner config now? Enter BADGE admin API key (leave empty to only copy):',
      cachedKey
    );
    const adminKey = String(enteredKey || '').trim();

    const fallbackCopy = () => {
      navigator.clipboard.writeText(json).then(() => {
        showMessage('success', 'Scanner config copied to clipboard');
      }).catch(() => {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'badge-scanner-config.json';
        a.click();
        URL.revokeObjectURL(url);
        showMessage('success', 'Scanner config downloaded');
      });
    };

    if (!adminKey) {
      fallbackCopy();
      return;
    }

    sessionStorage.setItem('badge_admin_api_key', adminKey);

    publishScannerConfigs({ badgeConfigs: parsed, adminKey })
      .then((result) => {
        if (result && result.status === 'ok') {
          showMessage('success', `Published scanner config (${result.count} badges)`);
          return;
        }
        showMessage('error', 'Publish failed. Scanner config copied instead.');
        fallbackCopy();
      })
      .catch(() => {
        showMessage('error', 'Publish failed. Scanner config copied instead.');
        fallbackCopy();
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
          { key: 'onchain', label: 'On-Chain Control', icon: '⛓️' },
          { key: 'import', label: 'Import / Export', icon: '📦' },
        ].map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`ba-subtab ${subTab === tab.key ? 'active' : ''}`}
            onClick={() => { setSubTab(tab.key); if (tab.key !== 'create') resetForm(); }}
          >
            <span className="ba-subtab-icon" aria-hidden="true">{tab.icon}</span>
            <span className="ba-subtab-label">{tab.label}</span>
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
                        {badge.metadata?.special?.isSpecial && (
                          <span className="ba-criteria-tag">✨ Special</span>
                        )}
                        {badge.metadata?.special?.timeLimited?.enabled && (
                          <span className="ba-criteria-tag">⏳ Time-limited</span>
                        )}
                        {badge.metadata?.special?.reward?.enabled && (
                          <span className="ba-criteria-tag">🎁 Top {badge.metadata?.special?.reward?.winnerLimit || 100} reward</span>
                        )}
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

              <div className="ba-field-row">
                <div className="ba-field">
                  <label>Mint Fee Preset</label>
                  <select
                    value={form.mintFeePreset}
                    onChange={(e) => handleMintFeePresetChange(e.target.value)}
                    className="ba-select"
                  >
                    <option value="free">Free</option>
                    <option value="1">1 MOVE</option>
                    <option value="2">2 MOVE</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div className="ba-field">
                  <label>Mint Fee (MOVE)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.00000001"
                    value={form.mintFeeMove}
                    onChange={(e) => updateForm('mintFeeMove', e.target.value)}
                    className="ba-input"
                    disabled={form.mintFeePreset !== 'custom'}
                  />
                </div>
              </div>

              <p className="ba-hint">0 = free. 1 MOVE = 100,000,000 octas on-chain.</p>

              <div className="ba-special-inline">
                <div className="ba-field-toggle">
                  <label className="ba-toggle-label">
                    <input
                      type="checkbox"
                      checked={Boolean(form.metadata?.special?.isSpecial)}
                      onChange={(e) => toggleSpecialBadge(e.target.checked)}
                    />
                    <span>Mark as Special Badge</span>
                  </label>
                </div>

                {Boolean(form.metadata?.special?.isSpecial) && (
                  <div className="ba-special-grid">
                    <div className="ba-special-panel">
                      <h4>Time Window</h4>
                      <p className="ba-hint">Set a claim window for this special badge.</p>

                      <div className="ba-field-toggle">
                        <label className="ba-toggle-label">
                          <input
                            type="checkbox"
                            checked={Boolean(form.metadata?.special?.timeLimited?.enabled)}
                            onChange={(e) => updateSpecialSettings('timeLimited', 'enabled', e.target.checked)}
                          />
                          <span>Enable time-limited mode</span>
                        </label>
                      </div>

                      <div className="ba-field">
                        <label>Start Time</label>
                        <input
                          type="datetime-local"
                          value={form.metadata?.special?.timeLimited?.startsAt || ''}
                          onChange={(e) => updateSpecialSettings('timeLimited', 'startsAt', e.target.value)}
                          className="ba-input"
                        />
                      </div>

                      <div className="ba-field">
                        <label>End Time</label>
                        <input
                          type="datetime-local"
                          value={form.metadata?.special?.timeLimited?.endsAt || ''}
                          onChange={(e) => updateSpecialSettings('timeLimited', 'endsAt', e.target.value)}
                          className="ba-input"
                        />
                      </div>

                      <div className="ba-field">
                        <label>Campaign Note</label>
                        <input
                          type="text"
                          placeholder="Optional event note"
                          value={form.metadata?.special?.timeLimited?.note || ''}
                          onChange={(e) => updateSpecialSettings('timeLimited', 'note', e.target.value)}
                          className="ba-input"
                        />
                      </div>
                    </div>

                    <div className="ba-special-panel">
                      <h4>Reward Setup</h4>
                      <p className="ba-hint">Example: reward first 100 users who earn this badge.</p>

                      <div className="ba-field-toggle">
                        <label className="ba-toggle-label">
                          <input
                            type="checkbox"
                            checked={Boolean(form.metadata?.special?.reward?.enabled)}
                            onChange={(e) => updateSpecialSettings('reward', 'enabled', e.target.checked)}
                          />
                          <span>Enable reward distribution</span>
                        </label>
                      </div>

                      <div className="ba-field-row">
                        <div className="ba-field">
                          <label>Winner Limit</label>
                          <input
                            type="number"
                            min="1"
                            value={form.metadata?.special?.reward?.winnerLimit || 100}
                            onChange={(e) => updateSpecialSettings('reward', 'winnerLimit', Number(e.target.value) || 100)}
                            className="ba-input"
                          />
                        </div>

                        <div className="ba-field">
                          <label>Reward Type</label>
                          <input
                            type="text"
                            placeholder="Token / NFT / Access"
                            value={form.metadata?.special?.reward?.rewardType || ''}
                            onChange={(e) => updateSpecialSettings('reward', 'rewardType', e.target.value)}
                            className="ba-input"
                          />
                        </div>
                      </div>

                      <div className="ba-field">
                        <label>Reward Value</label>
                        <input
                          type="text"
                          placeholder="e.g. 50 USDT or VIP Pass"
                          value={form.metadata?.special?.reward?.rewardValue || ''}
                          onChange={(e) => updateSpecialSettings('reward', 'rewardValue', e.target.value)}
                          className="ba-input"
                        />
                      </div>

                      <div className="ba-field">
                        <label>Distribution Date</label>
                        <input
                          type="datetime-local"
                          value={form.metadata?.special?.reward?.distributionDate || ''}
                          onChange={(e) => updateSpecialSettings('reward', 'distributionDate', e.target.value)}
                          className="ba-input"
                        />
                      </div>

                      <div className="ba-field">
                        <label>Reward Title</label>
                        <input
                          type="text"
                          placeholder="Reward campaign title"
                          value={form.metadata?.special?.reward?.rewardTitle || ''}
                          onChange={(e) => updateSpecialSettings('reward', 'rewardTitle', e.target.value)}
                          className="ba-input"
                        />
                      </div>

                      <div className="ba-field">
                        <label>Reward Details</label>
                        <textarea
                          rows={4}
                          placeholder="Leave empty for now"
                          value={form.metadata?.special?.reward?.rewardDetails || ''}
                          onChange={(e) => updateSpecialSettings('reward', 'rewardDetails', e.target.value)}
                          className="ba-textarea"
                        />
                      </div>
                    </div>
                  </div>
                )}
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
              <p className="ba-hint">Mintable badges currently support exactly one on-chain criterion.</p>

              {form.criteria.map((criterion, i) => renderCriterionForm(criterion, i))}

              <button
                type="button"
                className="ba-btn ba-btn-secondary ba-btn-add-criterion"
                onClick={addCriterion}
                disabled={form.criteria.length >= 1}
              >
                + Add Another Criterion
              </button>
            </div>
          </div>

          <div className="ba-live-preview" aria-label="Badge live preview">
            <div className="ba-live-preview-head">
              <span>Live Preview</span>
            </div>
            <div className="ba-live-card" style={{ '--preview-accent': previewRarity.color }}>
              <div className="ba-live-card-media">
                {form.imageUrl ? (
                  <img
                    src={form.imageUrl}
                    alt="Badge preview"
                    className="ba-live-card-image"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    onLoad={(e) => { e.currentTarget.style.display = 'block'; }}
                  />
                ) : null}
                {!form.imageUrl && <span className="ba-live-card-fallback">{previewIcon}</span>}
                <span className="ba-live-rarity-pill" style={{ background: previewRarity.color }}>{previewRarity.name}</span>
                <span className="ba-live-xp-pill">+{Number(form.xp) || 0} XP</span>
              </div>
              <div className="ba-live-card-content">
                <h4>{form.name?.trim() || 'Badge Name Preview'}</h4>
                <p>{form.description?.trim() || 'Badge description preview will appear here as you type.'}</p>
                <div className="ba-live-chip-row">
                  <span className="ba-live-chip">{Object.values(BADGE_CATEGORIES).find(cat => cat.id === form.category)?.icon || '🏅'} {form.category || 'activity'}</span>
                  {form.metadata?.special?.isSpecial && <span className="ba-live-chip">✨ Special</span>}
                  {form.metadata?.special?.timeLimited?.enabled && <span className="ba-live-chip">⏳ Time-limited</span>}
                  <span className="ba-live-chip">Fee: {Number(form.mintFeeMove || 0) > 0 ? `${form.mintFeeMove} MOVE` : 'Free'}</span>
                </div>
                <div className="ba-live-chip-row">
                  {form.criteria.filter((c) => c.type).slice(0, 3).map((criterion, idx) => (
                    <span key={`${criterion.type}-${idx}`} className="ba-live-chip ba-live-chip-criteria">
                      {CRITERIA_LABELS[criterion.type] || criterion.type}
                    </span>
                  ))}
                  {form.criteria.filter((c) => c.type).length > 3 && (
                    <span className="ba-live-chip ba-live-chip-criteria">+{form.criteria.filter((c) => c.type).length - 3} more</span>
                  )}
                </div>
              </div>
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

      {/* ─── On-Chain Control Tab ───────────────────────────────────── */}
      {subTab === 'onchain' && (
        <div className="ba-onchain-manage">
          <div className="ba-onchain-header">
            <h3>On-Chain Badge Management</h3>
            <p className="ba-hint">
              Pause, resume, or discontinue badges directly on the blockchain.
              {!connected && ' Connect your admin wallet to manage badges.'}
            </p>
            <button 
              className="ba-btn ba-btn-secondary" 
              onClick={loadOnChainBadges}
              disabled={onChainLoading}
            >
              {onChainLoading ? 'Loading...' : '🔄 Refresh'}
            </button>
          </div>

          {onChainLoading ? (
            <div className="ba-loading">Loading on-chain badges...</div>
          ) : onChainBadges.length === 0 ? (
            <div className="ba-empty">
              <p>No badges found on-chain. Create badges to see them here.</p>
            </div>
          ) : (
            <div className="ba-onchain-list">
              {onChainBadges.map(badge => {
                const statusLabel = BADGE_STATUS_LABELS[badge.status] || 'Unknown';
                const statusColor = BADGE_STATUS_COLORS[badge.status] || '#888';
                const timeRemaining = getBadgeTimeRemaining(badge);
                const supplyInfo = getBadgeSupplyInfo(badge);
                const isLoading = actionLoading === badge.id;
                
                return (
                  <div key={badge.id} className={`ba-onchain-item ${badge.status === BADGE_STATUS.DISCONTINUED ? 'discontinued' : ''}`}>
                    <div className="ba-onchain-preview">
                      {badge.imageUri ? (
                        <img src={badge.imageUri} alt={badge.name} className="ba-onchain-thumb" />
                      ) : (
                        <div className="ba-onchain-placeholder">#{badge.id}</div>
                      )}
                    </div>
                    
                    <div className="ba-onchain-info">
                      <div className="ba-onchain-title-row">
                        <h4>#{badge.id} - {badge.name}</h4>
                        <span className="ba-status-pill" style={{ background: statusColor }}>
                          {statusLabel}
                        </span>
                      </div>
                      
                      <p className="ba-onchain-desc">{badge.description || 'No description'}</p>
                      
                      <div className="ba-onchain-stats">
                        <span>Minted: {badge.totalMinted}{supplyInfo.unlimited ? '' : ` / ${badge.maxSupply}`}</span>
                        {!supplyInfo.unlimited && (
                          <span className={supplyInfo.soldOut ? 'ba-sold-out' : ''}>
                            {supplyInfo.soldOut ? '🔴 Sold Out' : `${supplyInfo.remaining} remaining`}
                          </span>
                        )}
                        {badge.isTimeLimited && (
                          <span className={timeRemaining?.expired ? 'ba-expired' : ''}>
                            {timeRemaining?.expired ? '⏰ Expired' : `⏳ ${timeRemaining?.formatted} left`}
                          </span>
                        )}
                      </div>
                      
                      <div className="ba-onchain-meta">
                        <span>Rule: {BADGE_RULES[badge.ruleType] ? Object.keys(BADGE_RULES).find(k => BADGE_RULES[k] === badge.ruleType) : `Type ${badge.ruleType}`}</span>
                        <span>Category: {badge.category || 'N/A'}</span>
                        <span>XP: {badge.xpValue || 0}</span>
                      </div>
                    </div>
                    
                    <div className="ba-onchain-actions">
                      {badge.status === BADGE_STATUS.ACTIVE && (
                        <button 
                          className="ba-btn ba-btn-warning"
                          onClick={() => handlePauseBadge(badge.id)}
                          disabled={!connected || isLoading}
                          title="Pause badge minting"
                        >
                          {isLoading ? '...' : '⏸️ Pause'}
                        </button>
                      )}
                      
                      {badge.status === BADGE_STATUS.PAUSED && (
                        <button 
                          className="ba-btn ba-btn-success"
                          onClick={() => handleResumeBadge(badge.id)}
                          disabled={!connected || isLoading}
                          title="Resume badge minting"
                        >
                          {isLoading ? '...' : '▶️ Resume'}
                        </button>
                      )}
                      
                      {badge.status !== BADGE_STATUS.DISCONTINUED && (
                        <button 
                          className="ba-btn ba-btn-danger"
                          onClick={() => handleDiscontinueBadge(badge.id)}
                          disabled={!connected || isLoading}
                          title="Permanently discontinue badge"
                        >
                          {isLoading ? '...' : '🚫 Discontinue'}
                        </button>
                      )}
                      
                      {badge.status === BADGE_STATUS.DISCONTINUED && (
                        <span className="ba-discontinued-label">Permanently Discontinued</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            <button className="ba-btn ba-btn-secondary" onClick={handleExportScannerConfig} style={{ marginTop: '0.75rem' }}>
              Export Scanner Config
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
