import React, { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useMovementClient } from '../../hooks/useMovementClient';
import { useTransactionTracker } from '../../hooks/useTransactionTracker';

import { 
  fetchAllBadges, 
  saveBadgeDefinitions,
  manageBadgeDefinition,
  importAllowlist
} from '../../services/api';
import { mapBadgeDefinitionToRow } from '../../utils/badgeUtils';
import { createAdminProofHeaders } from '../../services/adminProof';

import { 
  createBadge as createOnChainBadge,
  waitForTxAndGetId,
  buildMetadataJson,
  buildMetadataDataUri
} from '../../services/badgeService';

import { 
  BADGE_CATEGORIES, 
  CRITERIA_TYPES,
  getRarityInfo,
  createBadgeDefinition
} from '../../config/badges';

import RegistryController from './RegistryController';
import BadgeManager from './BadgeManager';
import BadgeDefinitionForm from './BadgeDefinitionForm';
import OnChainBadgeList from './OnChainBadgeList';
import AllowlistEditor from './AllowlistEditor';
// Removed getAggregatedStats import - client-side stats are no longer used in the simplified architecture

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
  const { connected, account, signAndSubmitTransaction, signMessage } = useWallet();
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

  const createManageBadgeAuth = useCallback(async (body) => {
    if (!account || !signMessage) throw new Error('Wallet not ready for signing');
    return await createAdminProofHeaders({ 
      account, 
      signMessage, 
      action: 'manage-badge-definition', 
      body 
    });
  }, [account, signMessage]);

  const loadBadges = useCallback(async () => {
    setLoading(true);
    try {
      // Use the dedicated admin fetcher which includes private/inactive badges
      const auth = await createManageBadgeAuth({ action: 'list-all-badges' });
      const { fetchAdminBadges } = await import('../../services/api');
      const result = await fetchAdminBadges(auth);
      
      if (result.ok) {
        setBadges(result.badges || []);
      } else {
        // Fallback to public list if admin fetch fails (e.g. signature rejected)
        const publicResult = await fetchAllBadges();
        if (publicResult.ok) setBadges(publicResult.badges || []);
      }
    } catch (err) {
      console.error('[BadgeAdmin] Load failed', err);
      // Final fallback
      const publicResult = await fetchAllBadges();
      if (publicResult.ok) setBadges(publicResult.badges || []);
    } finally {
      setLoading(false);
    }
  }, [createManageBadgeAuth]);

  const refreshStats = useCallback(async () => {
    // refreshStats is now a no-op as server handles aggregation
    console.log('[BadgeAdmin] Stats refresh is now handled by the server');
  }, []);

  useEffect(() => { 
    loadBadges(); 
    refreshStats();
  }, [loadBadges, refreshStats]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSubmitting(false);
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
        mintFee: Math.floor(Number(form.mintFeeMove) * 100_000_000),
        startsAt: 0,
        endsAt: 0,
        maxSupply: 0
      });

      const txResult = await trackTransaction(`Creating On-Chain Badge: ${form.name}`, txPromise);
      
      showMessage('info', 'Waiting for on-chain confirmation...');
      let onChainBadgeId;
      try {
        onChainBadgeId = await waitForTxAndGetId(movementClient, txResult.hash);
      } catch (waitErr) {
        console.error('[BadgeAdmin] Event detection failed:', waitErr);
        // Fallback or more descriptive error
        throw new Error(`Transaction succeeded but badge ID detection failed. Please check the explorer: ${txResult.hash}`);
      }
      
      if (!onChainBadgeId) throw new Error('Failed to detect new badge ID from events. The transaction was successful, but the indexer may be lagging.');

      // 4. Handle Allowlist offboarding (extract addresses for dedicated table)
      const allowlistCriterion = form.criteria.find(c => c.type === 'allowlist');
      const allowlistAddresses = (allowlistCriterion?.params as any)?.addresses || [];
      
      // Strip large addresses array from the definition to keep DB light
      const sanitizedForm = {
        ...form,
        criteria: form.criteria.map(c => {
          if (c.type === 'allowlist') {
            return { ...c, params: { ...(c.params as any), addresses: [] } };
          }
          return c;
        })
      };

      const badgePayload = { ...sanitizedForm, onChainBadgeId, id: `badge_${Date.now()}` };
      
      // FIX: Sign the exact body that saveBadgeDefinitions will send (batch_sync)
      const auth = await createManageBadgeAuth({ 
        action: 'batch_sync', 
        badges: [mapBadgeDefinitionToRow(badgePayload as any)] 
      });
      
      const apiResult = await saveBadgeDefinitions({ 
        badges: [badgePayload as any], 
        adminAuth: auth 
      });

      if (!apiResult.ok) throw new Error(apiResult.error || 'Database save failed');

      // 5. Bulk Import Allowlist if needed
      if (allowlistAddresses.length > 0) {
        showMessage('info', `Importing ${allowlistAddresses.length} allowlist addresses...`);
        const importResult = await importAllowlist(badgePayload.id, allowlistAddresses, auth);
        if (!importResult.ok) {
           console.warn('[BadgeAdmin] Allowlist import partial failure', importResult.error);
           showMessage('warning', `Badge created, but allowlist import had issues: ${importResult.error}`);
        }
      }

      showMessage('success', `Badge #${onChainBadgeId} created and synced!`);
      resetForm();
      setSubTab('manage');
      loadBadges();
    } catch (err) {
      console.error('Error saving entity:', err);
      let errorMsg = err.message || 'Error saving entity';
      if (err.code === '42501') {
        errorMsg = 'Permission denied: Only administrators can manage entities. Please ensure you are logged in with the admin wallet.';
      }
      setMessage({ text: errorMsg, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSync = async () => {
    if (!connected || !account) return;
    setSubmitting(true);
    try {
      showMessage('info', `Syncing ${badges.length} badges to server...`);
      const auth = await createManageBadgeAuth({ 
        action: 'batch_sync', 
        badges: badges.map(b => mapBadgeDefinitionToRow(b as any)) 
      });
      
      const apiResult = await saveBadgeDefinitions({ 
        badges: badges as any[], 
        adminAuth: auth 
      });

      if (!apiResult.ok) throw new Error(apiResult.error || 'Sync failed');
      
      showMessage('success', `Successfully synced ${badges.length} badges to production!`);
      loadBadges();
    } catch (err: any) {
      console.error('[BadgeAdmin] Bulk sync failed', err);
      showMessage('error', err.message || 'Bulk sync failed');
    } finally {
      setSubmitting(false);
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
        
        {badges.length > 0 && (
          <button 
            className="ba-subtab ba-sync-btn" 
            onClick={handleBulkSync} 
            disabled={submitting}
            title="Push local definitions to production database"
          >
            ☁️ {submitting ? 'Syncing...' : 'Sync to Server'}
          </button>
        )}
      </div>

      {/* adminStats status bar removed - server-side evaluation is the source of truth */}

      <div className="ba-content">
        {subTab === 'manage' && (
          <BadgeManager 
             badges={badges} 
             handleEdit={(b) => { setForm(b); setEditingId(b.id); setSubTab('create'); }}
             handleDelete={handleDelete}
             handleRestore={() => {}}
             handleToggle={() => {}} 
             handleTogglePublic={() => {}}
             handleManageAllowlist={(b) => setManagingAllowlist(b)}
             setSubTab={setSubTab}
             showDeleted={false}
             setShowDeleted={() => {}}
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
