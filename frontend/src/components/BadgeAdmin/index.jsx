import React, { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useMovementClient } from '../../hooks/useMovementClient.js';
import { useTransactionTracker } from '../../hooks/useTransactionTracker.js';

import { 
  fetchAllBadges, 
  saveBadgeDefinitions,
  manageBadgeDefinition 
} from '../../services/badgeApi.js';
import { createAdminProofHeaders } from '../../services/adminProof.js';

import { 
  createBadge as createOnChainBadge,
  waitForTxAndGetId,
  buildMetadataJson,
  buildMetadataDataUri
} from '../../services/badgeService.js';

import { 
  BADGE_CATEGORIES, 
  CRITERIA_TYPES,
  getRarityInfo 
} from '../../config/badges.js';

import RegistryController from './RegistryController.jsx';
import BadgeManager from './BadgeManager.jsx';
import BadgeDefinitionForm from './BadgeDefinitionForm.jsx';
import OnChainBadgeList from './OnChainBadgeList.jsx';
import AllowlistEditor from './AllowlistEditor.jsx';
import { getAggregatedStats } from '../../services/badges/engineService.js';

import '../BadgeAdmin.css';

const EMPTY_FORM = {
  name: '',
  description: '',
  imageUrl: '',
  category: 'activity',
  rarity: 'COMMON',
  xp: 10,
  mintFeePreset: 'free',
  mintFeeMove: '0',
  criteria: [{ type: '', params: {} }],
  metadata: {
    externalUrl: '',
    special: { 
      isSpecial: false, 
      timeLimited: { enabled: false, startsAt: '', endsAt: '' },
      rewards: { enabled: false, tokenAmount: '0', tokenSymbol: 'MOVE', strategy: 'first_come', limit: 100 }
    }
  },
  isPublic: true
};

const CRITERIA_DISPLAY_LIST = [
  { type: CRITERIA_TYPES.TRANSACTION_COUNT, label: '📊 Transaction Count — Requires a minimum number of on-chain transactions' },
  { type: CRITERIA_TYPES.DAYS_ONCHAIN, label: '📅 Days On-chain — Requires a minimum number of days since first transaction' },
  { type: CRITERIA_TYPES.MIN_BALANCE, label: '💰 Minimum Balance — Requires holding a minimum balance of a specific token' },
  { type: CRITERIA_TYPES.PROTOCOL_USAGE, label: '🏗️ Protocol Usage — Requires interaction with a specific DeFi protocol' },
  { type: CRITERIA_TYPES.PROTOCOL_COUNT, label: '🧩 Protocol Interaction Count — Requires interaction with a minimum number of unique DeFi protocols/dApps' },
  { type: CRITERIA_TYPES.ALLOWLIST, label: '📋 Allowlist — Requires the user address to be on an allow list' },
  { type: CRITERIA_TYPES.DAFTAR_PROFILE_COMPLETE, label: '👤 Daftar Profile Complete — User has completed their profile (Username, Bio, PFP)' },
  { type: CRITERIA_TYPES.DAFTAR_SWAP_COUNT, label: '🚀 Daftar Swap Count — Requires a minimum number of swaps on the Daftar platform' },
  { type: CRITERIA_TYPES.DAFTAR_VOLUME_USD, label: '💎 Daftar Trade Volume (USD) — Requires a minimum total USD volume swapped on Daftar' },
];

export default function BadgeAdmin() {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const { client: movementClient } = useMovementClient();
  const { pendingTx, trackTransaction } = useTransactionTracker();

  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState('manage');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [adminStats, setAdminStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [managingAllowlist, setManagingAllowlist] = useState(null);

  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 6000);
  }, []);

  const loadBadges = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchAllBadges({ includePrivate: true });
      if (result.ok) setBadges(result.badges || []);
    } catch (err) {
      console.error('[BadgeAdmin] Load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    if (!account) return;
    setStatsLoading(true);
    try {
      const stats = await getAggregatedStats(account.address.toString());
      setAdminStats(stats);
    } catch (err) {
      console.warn('[BadgeAdmin] Stats fetch failed', err);
    } finally {
      setStatsLoading(false);
    }
  }, [account]);

  useEffect(() => { 
    loadBadges(); 
    refreshStats();
  }, [loadBadges, refreshStats]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSubmitting(false);
  };

  const createManageBadgeAuth = async (body) => {
    if (!account || !window.aptos?.signMessage) throw new Error('Wallet not ready for signing');
    return await createAdminProofHeaders({ 
      account, 
      signMessage: (args) => window.aptos.signMessage(args), 
      action: 'manage-badge-definition', 
      body 
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!connected || !account) return;
    setSubmitting(true);

    try {
      const metadataJson = buildMetadataJson({
         name: form.name,
         description: form.description,
         imageUri: form.imageUrl,
         externalUrl: form.metadata.externalUrl,
         attributes: [
           { trait_type: 'category', value: form.category },
           { trait_type: 'xp', value: String(form.xp) }
         ]
      });
      const metadataUri = buildMetadataDataUri(metadataJson);

      const txPromise = createOnChainBadge({
        signAndSubmitTransaction,
        sender: account.address.toString(),
        name: form.name,
        description: form.description,
        imageUri: form.imageUrl,
        metadataUri,
        category: form.category,
        rarity: getRarityInfo(form.rarity).level,
        xpValue: form.xp,
        mintFee: Math.floor(Number(form.mintFeeMove) * 100_000_000)
      });

      const txResult = await trackTransaction(`Creating On-Chain Badge: ${form.name}`, txPromise);
      
      showMessage('info', 'Waiting for on-chain confirmation...');
      const onChainBadgeId = await waitForTxAndGetId(movementClient, txResult.hash);
      
      if (!onChainBadgeId) throw new Error('Failed to detect new badge ID from events');

      // 4. Handle Allowlist offboarding (extract addresses for dedicated table)
      const allowlistCriterion = form.criteria.find(c => c.type === 'allowlist');
      const allowlistAddresses = allowlistCriterion?.params?.addresses || [];
      
      // Strip large addresses array from the definition to keep DB light
      const sanitizedForm = {
        ...form,
        criteria: form.criteria.map(c => {
          if (c.type === 'allowlist') {
            return { ...c, params: { ...c.params, addresses: [] } };
          }
          return c;
        })
      };

      const badgePayload = { ...sanitizedForm, onChainBadgeId, id: `badge_${Date.now()}` };
      const auth = await createManageBadgeAuth({ action: 'create', badge: badgePayload });
      
      const apiResult = await saveBadgeDefinitions({ 
        badges: [badgePayload], 
        adminAuth: auth 
      });

      if (!apiResult.ok) throw new Error(apiResult.data?.error || 'Database save failed');

      // 5. Bulk Import Allowlist if needed
      if (allowlistAddresses.length > 0) {
        showMessage('info', `Importing ${allowlistAddresses.length} allowlist addresses...`);
        const importResult = await importAllowlist(badgePayload.id, allowlistAddresses, auth);
        if (!importResult.ok) {
           console.warn('[BadgeAdmin] Allowlist import partial failure', importResult.data);
           showMessage('warning', `Badge created, but allowlist import had issues: ${importResult.data?.error}`);
        }
      }

      showMessage('success', `Badge #${onChainBadgeId} created and synced!`);
      resetForm();
      setSubTab('manage');
      loadBadges();
    } catch (err) {
      console.error('[BadgeAdmin] Submit error', err);
      showMessage('error', err.message || 'Failed to create badge');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
       const badge = badges.find(b => b.id === id);
       const auth = await createManageBadgeAuth({ action: 'delete', badge: { badge_id: id } });
       const res = await manageBadgeDefinition('delete', { badge_id: id }, auth);
       if (res.error) throw res.error;
       showMessage('success', 'Badge definition deleted');
       loadBadges();
    } catch (err) {
       showMessage('error', err.message || 'Delete failed');
    }
  };

  const protocolOptions = [{ value: 'mosaic', label: 'Mosaic' }];
  const criteriaOptions = CRITERIA_DISPLAY_LIST;

  return (
    <div className="ba-container">
      {message.text && (
        <div className={`ba-message ba-message-${message.type}`}>
          {message.text}
        </div>
      )}
      
      {pendingTx && (
        <div className="ba-pending-tx-toast">
          <span className="ba-spinner">🔄</span>
          <span>{pendingTx.description}...</span>
        </div>
      )}

      <div className="ba-subtabs">
        <button className={`ba-subtab ${subTab === 'manage' ? 'active' : ''}`} onClick={() => setSubTab('manage')}>📋 Manage</button>
        <button className={`ba-subtab ${subTab === 'create' ? 'active' : ''}`} onClick={() => setSubTab('create')}>➕ Create</button>
        <button className={`ba-subtab ${subTab === 'onchain' ? 'active' : ''}`} onClick={() => setSubTab('onchain')}>⛓️ On-Chain</button>
      </div>

      {adminStats && (
        <div className="ba-engine-status-bar">
          <div className="ba-status-item">
            <span className="ba-status-dot green" />
            <span>Engine v2 Online</span>
          </div>
          <div className="ba-status-meta">
             <span>Your Txs: <strong>{adminStats.txCount}</strong></span>
             <span>|</span>
             <span>Balances: <strong>{adminStats.balances?.length || 0} Assets</strong></span>
             <button className="ba-link-btn" onClick={refreshStats} disabled={statsLoading}>
               {statsLoading ? '...' : '🔄 Sync'}
             </button>
          </div>
        </div>
      )}

      <div className="ba-content">
        {subTab === 'manage' && (
          <BadgeManager 
             badges={badges} 
             handleEdit={(b) => { setForm(b); setEditingId(b.id); setSubTab('create'); }}
             handleDelete={handleDelete}
             handleManageAllowlist={(b) => setManagingAllowlist(b)}
             handleToggle={() => {}} 
             handleTogglePublic={() => {}}
             setSubTab={setSubTab}
          />
        )}
        {managingAllowlist && (
          <AllowlistEditor 
            badge={managingAllowlist}
            account={account}
            onClose={() => setManagingAllowlist(null)}
            showMessage={showMessage}
          />
        )}
        {subTab === 'create' && (
          <BadgeDefinitionForm 
             form={form} setForm={setForm} editingId={editingId}
             submitting={submitting} handleSubmit={handleSubmit} resetForm={resetForm}
             protocolOptions={protocolOptions} criteriaOptions={criteriaOptions}
          />
        )}
        {subTab === 'onchain' && (
          <div className="ba-onchain-split">
             <RegistryController 
                movementClient={movementClient} account={account} connected={connected}
                signAndSubmitTransaction={signAndSubmitTransaction} showMessage={showMessage}
             />
             <div className="ba-divider-v" />
             <OnChainBadgeList 
                movementClient={movementClient} account={account} connected={connected}
                signAndSubmitTransaction={signAndSubmitTransaction} showMessage={showMessage}
             />
          </div>
        )}
      </div>
    </div>
  );
}
