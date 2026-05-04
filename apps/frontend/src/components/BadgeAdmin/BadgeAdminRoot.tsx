import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useMovementClient } from '../../hooks/useMovementClient';
import { useTransactionTracker } from '../../hooks/useTransactionTracker';

import { 
  fetchAllBadges, 
  fetchAdminBadges,
  saveBadgeDefinitions,
  manageBadgeDefinition 
} from '../../services/api';
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
  getRarityInfo 
} from '../../config/badges';

import RegistryController from './RegistryController';
import BadgeManager from './BadgeManager';
import BadgeDefinitionForm from './BadgeDefinitionForm';
import OnChainBadgeList from './OnChainBadgeList';

import '../BadgeAdmin.css';

const EMPTY_FORM = {
  name: '',
  description: '',
  imageUrl: '',
  category: 'activity',
  rarity: 'COMMON',
  xp: 10,
  mintFeeMove: '0',
  criteria: [{ type: '', params: {} }],
  metadata: {
    externalUrl: '',
    special: { isSpecial: false, timeLimited: { enabled: false, startsAt: '', endsAt: '' } }
  },
  enabled: true,
  isPublic: true
};

export default function BadgeAdminRoot() {
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
  const [showDeleted, setShowDeleted] = useState(false);

  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 6000);
  }, []);

  const loadBadges = useCallback(async () => {
    setLoading(true);
    try {
      let result;
      if (account) {
        const auth = await createAdminProofHeaders({ account, signMessage: window.aptos?.signMessage, action: 'list-all-badges', body: {} });
        result = await fetchAdminBadges(auth);
      } else {
        result = await fetchAllBadges({ includePrivate: true });
      }
      
      if (result.ok) setBadges(result.badges || []);
    } catch (err) {
      console.error('[BadgeAdmin] Load failed', err);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => { loadBadges(); }, [loadBadges]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSubmitting(false);
  };

  const createManageBadgeAuth = async (body) => {
    return await createAdminProofHeaders({ account, signMessage: window.aptos?.signMessage, action: 'manage-badge-definition', body });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!connected || !account) return;
    setSubmitting(true);

    try {
      // 1. Prepare Metadata
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

      // 2. Create On-Chain
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
      
      // 3. Robust ID lookup
      showMessage('info', 'Waiting for on-chain confirmation...');
      const onChainBadgeId = await waitForTxAndGetId(movementClient, txResult.hash);
      
      if (!onChainBadgeId) throw new Error('Failed to detect new badge ID from events');

      // 4. Save to Database
      const badgePayload = { ...form, onChainBadgeId, id: `badge_${Date.now()}` };
      const auth = await createManageBadgeAuth({ action: 'create', badge: badgePayload });
      const apiResult = await saveBadgeDefinitions({ 
        badges: [badgePayload], 
        adminAuth: auth 
      });

      if (!apiResult.ok) throw new Error(apiResult.data?.error || 'Database save failed');

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
       const auth = await createManageBadgeAuth({ action: 'delete', badge: { badge_id: id } });
       const res = await manageBadgeDefinition('delete', { badge_id: id }, auth);
       if (res.error) throw res.error;
       showMessage('success', 'Badge definition moved to trash');
       loadBadges();
    } catch (err) {
       showMessage('error', err.message || 'Delete failed');
    }
  };

  const handleRestore = async (id) => {
    try {
       const auth = await createManageBadgeAuth({ action: 'restore', badge: { badge_id: id } });
       const res = await manageBadgeDefinition('restore', { badge_id: id }, auth);
       if (res.error) throw res.error;
       showMessage('success', 'Badge definition restored');
       loadBadges();
    } catch (err) {
       showMessage('error', err.message || 'Restore failed');
    }
  };

  const protocolOptions = [{ value: 'mosaic', label: 'Mosaic' }];
  const criteriaOptions = Object.entries(BADGE_CATEGORIES).map(([key, val]) => ({ type: val.id, name: val.name }));

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

      <div className="ba-content">
        {subTab === 'manage' && (
          <BadgeManager 
             badges={badges} 
             handleEdit={(b) => { setForm(b); setEditingId(b.id); setSubTab('create'); }}
             handleDelete={handleDelete}
             handleRestore={handleRestore}
             handleToggle={() => {}} 
             handleTogglePublic={() => {}}
             handleManageAllowlist={() => {}}
             setSubTab={setSubTab}
             showDeleted={showDeleted}
             setShowDeleted={setShowDeleted}
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
