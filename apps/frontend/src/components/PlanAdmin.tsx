import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { managePlan, getPlansConfig, setSubscriptionPaymentConfig } from '../services/api';
import { createAdminProofHeaders } from '../services/adminProof';
import { useMovementClient } from '../hooks/useMovementClient';

interface UserProfile {
  wallet_address: string;
  username: string;
  subscription_tier: 'free' | 'lite' | 'pro';
  subscription_started_at?: string;
  subscription_expires_at?: string;
  avatar_url?: string;
  created_at: string;
}

export default function PlanAdmin() {
  const { account, signMessage, signAndSubmitTransaction } = useWallet();
  const { client: movementClient } = useMovementClient();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newTier, setNewTier] = useState<'free' | 'pro'>('pro');
  const [newExpiresAt, setNewExpiresAt] = useState<string>('');
  const [addLoading, setAddLoading] = useState(false);

  // States to track editing state for existing users in list
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editTier, setEditTier] = useState<'free' | 'pro'>('pro');
  const [editExpiresAt, setEditExpiresAt] = useState<string>('');

  // Payment config state
  const [paymentConfig, setPaymentConfig] = useState({
    price_usd: 5,
    discount_price_usd: '' as string | number,
    discount_label: '',
    treasury_wallet: '',
    duration_days: 30,
    discount_scope: 'all_months' as 'first_month' | 'all_months',
  });
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);

  const showMessage = (type: string, text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  const [contractConfig, setContractConfig] = useState({
    price_per_duration: 0,
    discount_price_per_duration: 0,
    discount_scope: 0,
    duration_in_seconds: 2592000,
  });
  const [contractConfigLoading, setContractConfigLoading] = useState(true);
  const [contractConfigSaving, setContractConfigSaving] = useState(false);

  // Load contract config
  useEffect(() => {
    async function loadContractConfig() {
      if (!movementClient) return;
      try {
        const res = await movementClient.getAccountResource({
          accountAddress: '0x2a5b1aad1cb52fa0f2be5da258cd85aa340f55bccd8cf684f89dbc6f5cbe0a69',
          resourceType: '0x2a5b1aad1cb52fa0f2be5da258cd85aa340f55bccd8cf684f89dbc6f5cbe0a69::subscription::SubscriptionRegistry'
        });
        if (res && res.data) {
          const data = res.data as any;
          setContractConfig({
            price_per_duration: Number(data.price_per_duration || 0) / 1e8,
            discount_price_per_duration: Number(data.discount_price_per_duration || 0) / 1e8,
            discount_scope: Number(data.discount_scope || 0),
            duration_in_seconds: Number(data.duration_in_seconds || 2592000),
          });
        }
      } catch (e) {
        console.warn("Could not fetch contract config", e);
      } finally {
        setContractConfigLoading(false);
      }
    }
    loadContractConfig();
  }, [movementClient]);

  const handleSyncToBlockchain = async () => {
    if (!account || !signAndSubmitTransaction) {
      showMessage('error', 'Wallet not connected');
      return;
    }
    setContractConfigSaving(true);
    try {
      const payload = {
        function: '0x2a5b1aad1cb52fa0f2be5da258cd85aa340f55bccd8cf684f89dbc6f5cbe0a69::subscription::update_pricing',
        typeArguments: [],
        functionArguments: [
          Math.floor(contractConfig.price_per_duration * 1e8),
          Math.floor(contractConfig.discount_price_per_duration * 1e8),
          contractConfig.discount_scope,
          contractConfig.duration_in_seconds
        ],
      };
      const response = await signAndSubmitTransaction({
        data: payload
      });
      await movementClient.waitForTransaction({ transactionHash: response.hash });
      showMessage('success', 'On-Chain Pricing updated successfully!');
    } catch (err: any) {
      showMessage('error', err.message || 'Failed to sync to blockchain');
    } finally {
      setContractConfigSaving(false);
    }
  };

  const createAuth = useCallback(async (body: any) => {
    if (!account || !signMessage) throw new Error('Wallet not ready');
    return await createAdminProofHeaders({
      account,
      signMessage,
      action: 'manage-subscriptions',
      body
    });
  }, [account, signMessage]);

  // Load existing payment config on mount
  useEffect(() => {
    getPlansConfig().then(cfg => {
      if (cfg) {
        setPaymentConfig({
          price_usd: cfg.basePriceUsd,
          discount_price_usd: cfg.discountPriceUsd !== null ? cfg.discountPriceUsd : '',
          discount_label: cfg.discountLabel,
          treasury_wallet: cfg.treasuryWallet,
          duration_days: cfg.durationDays,
          discount_scope: cfg.discountScope || 'all_months',
        });
        setDiscountEnabled(cfg.discountPriceUsd !== null && cfg.discountPriceUsd > 0);
      }
      setConfigLoading(false);
    }).catch(() => setConfigLoading(false));
  }, []);

  const handleSavePaymentConfig = useCallback(async () => {
    if (!account || !signMessage) {
      showMessage('error', 'Wallet not connected');
      return;
    }
    setConfigSaving(true);
    try {
      const payload = {
        ...paymentConfig,
        discount_price_usd: discountEnabled && paymentConfig.discount_price_usd !== ''
          ? Number(paymentConfig.discount_price_usd)
          : '',
        discount_label: discountEnabled ? paymentConfig.discount_label : '',
        discount_scope: discountEnabled ? paymentConfig.discount_scope : 'all_months',
      };
      const body = { method: 'SET_PAYMENT_CONFIG', ...payload };
      const auth = await createAdminProofHeaders({ account, signMessage, action: 'manage-subscriptions', body });
      const result = await setSubscriptionPaymentConfig(payload, auth);
      if (result.ok) {
        showMessage('success', 'Payment settings saved successfully!');
      } else {
        showMessage('error', result.error || 'Failed to save config');
      }
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setConfigSaving(false);
    }
  }, [paymentConfig, discountEnabled, account, signMessage]);

  const fetchUsers = useCallback(async (query = '', filter = 'all') => {
    setLoading(true);
    try {
      const body = { method: 'LIST', query, tierFilter: filter };
      const auth = await createAuth(body);
      const res = await managePlan(body as any, auth);
      if (res.ok && res.data?.users) {
        setUsers(res.data.users);
      } else {
        throw new Error(res.error || 'Failed to fetch users');
      }
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [createAuth]);

  useEffect(() => {
    fetchUsers(searchQuery, tierFilter);
  }, [fetchUsers, tierFilter]);

  const handleUpdateSubscription = async (
    targetAddress: string,
    tier: 'free' | 'pro',
    expiresAt: string | null,
    isNew = false
  ) => {
    if (isNew) setAddLoading(true);
    else setActionLoading(targetAddress);

    try {
      // Expiry timestamp check: convert local datetime input to ISO string
      const isoExpiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;

      const body = {
        method: 'SET_TIER',
        address: targetAddress,
        tier,
        expires_at: isoExpiresAt
      };

      const auth = await createAuth(body);
      const res = await managePlan(body as any, auth);

      if (res.ok) {
        showMessage(
          'success',
          `Successfully set ${targetAddress.slice(0, 8)}... to ${tier.toUpperCase()}`
        );

        if (isNew) {
          setNewAddress('');
          setNewExpiresAt('');
          setShowAddModal(false);
        } else {
          setEditingAddress(null);
        }

        // Reload all users
        fetchUsers(searchQuery, tierFilter);
      } else {
        throw new Error(res.error || 'Update failed');
      }
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setActionLoading(null);
      setAddLoading(false);
    }
  };

  const setExpiryPreset = (preset: 'month' | 'year' | 'never', type: 'new' | 'edit') => {
    if (preset === 'never') {
      if (type === 'new') setNewExpiresAt('');
      else setEditExpiresAt('');
      return;
    }
    const d = new Date();
    if (preset === 'month') {
      d.setMonth(d.getMonth() + 1);
    } else if (preset === 'year') {
      d.setFullYear(d.getFullYear() + 1);
    }
    // Format to yyyy-MM-ddThh:mm in local time for datetime-local input
    const offsetMs = d.getTimezoneOffset() * 60 * 1000;
    const localDate = new Date(d.getTime() - offsetMs);
    const formatted = localDate.toISOString().slice(0, 16);
    if (type === 'new') setNewExpiresAt(formatted);
    else setEditExpiresAt(formatted);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Never / Lifetime';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Never / Lifetime';
    return date.toLocaleString();
  };

  const startEditing = (user: UserProfile) => {
    setEditingAddress(user.wallet_address);
    // Map legacy 'lite' to 'pro' when starting to edit
    const currentEditTier = user.subscription_tier === 'lite' ? 'pro' : user.subscription_tier;
    setEditTier(currentEditTier);
    // Format expiration date for input
    if (user.subscription_expires_at) {
      try {
        const formatted = new Date(user.subscription_expires_at).toISOString().slice(0, 16);
        setEditExpiresAt(formatted);
      } catch {
        setEditExpiresAt('');
      }
    } else {
      setEditExpiresAt('');
    }
  };

  return (
    <div className="admin-content">

      <div className="admin-settings-card" style={{ marginBottom: '24px' }}>
        <h3>On-Chain Smart Contract Pricing</h3>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', marginBottom: '20px' }}>
          Configure the exact MOVE token prices encoded directly onto the blockchain. This is the source of truth for the subscription cost.
        </p>

        {contractConfigLoading ? (
          <div style={{ color: '#aaa', fontSize: '14px' }}>Loading on-chain config...</div>
        ) : (
          <div>
            <div className="admin-settings-grid">
              <div className="admin-form-group">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Base Price (MOVE)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={contractConfig.price_per_duration}
                  onChange={e => setContractConfig(p => ({ ...p, price_per_duration: Number(e.target.value) }))}
                  style={{ marginTop: '6px', width: '100%' }}
                />
              </div>

              <div className="admin-form-group">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Discount Price (MOVE)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={contractConfig.discount_price_per_duration}
                  onChange={e => setContractConfig(p => ({ ...p, discount_price_per_duration: Number(e.target.value) }))}
                  style={{ marginTop: '6px', width: '100%' }}
                />
              </div>

              <div className="admin-form-group">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Duration (Seconds)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={contractConfig.duration_in_seconds}
                  onChange={e => setContractConfig(p => ({ ...p, duration_in_seconds: Number(e.target.value) }))}
                  style={{ marginTop: '6px', width: '100%' }}
                />
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
                  ({(contractConfig.duration_in_seconds / 86400).toFixed(1)} days)
                </div>
              </div>
            </div>

            <div className="admin-form-group" style={{ marginTop: '16px' }}>
              <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Discount Application</label>
              <div style={{ display: 'flex', gap: '24px', marginTop: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#fff' }}>
                  <input
                    type="radio"
                    name="onchain_discount_scope"
                    value="0"
                    checked={contractConfig.discount_scope === 0}
                    onChange={() => setContractConfig(p => ({ ...p, discount_scope: 0 }))}
                    style={{ cursor: 'pointer' }}
                  />
                  No Discount
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#fff' }}>
                  <input
                    type="radio"
                    name="onchain_discount_scope"
                    value="1"
                    checked={contractConfig.discount_scope === 1}
                    onChange={() => setContractConfig(p => ({ ...p, discount_scope: 1 }))}
                    style={{ cursor: 'pointer' }}
                  />
                  First Period Only
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#fff' }}>
                  <input
                    type="radio"
                    name="onchain_discount_scope"
                    value="2"
                    checked={contractConfig.discount_scope === 2}
                    onChange={() => setContractConfig(p => ({ ...p, discount_scope: 2 }))}
                    style={{ cursor: 'pointer' }}
                  />
                  All Periods
                </label>
              </div>
            </div>

            <div style={{ marginTop: '20px' }}>
              <button
                className="admin-btn admin-btn-primary"
                onClick={handleSyncToBlockchain}
                disabled={contractConfigSaving}
              >
                {contractConfigSaving ? 'Syncing...' : 'Sync to Blockchain'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Legacy Display Config (USD) ── */}
      <div className="admin-settings-card" style={{ marginBottom: '28px', borderColor: 'rgba(205,161,105,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h3 style={{ margin: 0 }}>💳 Legacy Display Config (USD)</h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>
              Configure the approximate USD display values and treasury address.
            </p>
          </div>
          {configLoading && <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>Loading...</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Base price */}
          <div className="admin-form-group">
            <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Base Price (USD / month)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={paymentConfig.price_usd}
              onChange={e => setPaymentConfig(p => ({ ...p, price_usd: Number(e.target.value) }))}
              style={{ marginTop: '6px', width: '100%' }}
            />
            <small className="admin-field-hint">Standard Pro plan price in USD.</small>
          </div>

          {/* Duration */}
          <div className="admin-form-group">
            <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Subscription Duration (days)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={paymentConfig.duration_days}
              onChange={e => setPaymentConfig(p => ({ ...p, duration_days: Number(e.target.value) }))}
              style={{ marginTop: '6px', width: '100%' }}
            />
            <small className="admin-field-hint">How many days the Pro tier lasts per payment.</small>
          </div>

          {/* Treasury wallet — full width */}
          <div className="admin-form-group" style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Treasury Wallet Address</label>
            <input
              type="text"
              placeholder="0x..."
              value={paymentConfig.treasury_wallet}
              onChange={e => setPaymentConfig(p => ({ ...p, treasury_wallet: e.target.value }))}
              style={{ marginTop: '6px', width: '100%', fontFamily: 'monospace' }}
            />
            <small className="admin-field-hint">MOVE payments will be sent to this wallet address.</small>
          </div>
        </div>

        {/* Discount section */}
        <div style={{ marginTop: '20px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <label className="admin-checkbox" style={{ marginBottom: discountEnabled ? '16px' : 0 }}>
            <input
              type="checkbox"
              checked={discountEnabled}
              onChange={e => setDiscountEnabled(e.target.checked)}
            />
            Enable Discount Pricing
          </label>

          {discountEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
              <div className="admin-form-group">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Discounted Price (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  placeholder="e.g. 1"
                  value={paymentConfig.discount_price_usd}
                  onChange={e => setPaymentConfig(p => ({ ...p, discount_price_usd: e.target.value }))}
                  style={{ marginTop: '6px', width: '100%' }}
                />
              </div>
              <div className="admin-form-group">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Discount Label</label>
                <input
                  type="text"
                  placeholder="e.g. Launch Special"
                  value={paymentConfig.discount_label}
                  onChange={e => setPaymentConfig(p => ({ ...p, discount_label: e.target.value }))}
                  style={{ marginTop: '6px', width: '100%' }}
                />
              </div>

              {/* Discount Application Scope */}
              <div className="admin-form-group" style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>Discount Application</label>
                <div style={{ display: 'flex', gap: '24px', marginTop: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#fff' }}>
                    <input
                      type="radio"
                      name="discount_scope"
                      value="all_months"
                      checked={paymentConfig.discount_scope === 'all_months'}
                      onChange={() => setPaymentConfig(p => ({ ...p, discount_scope: 'all_months' }))}
                      style={{ cursor: 'pointer' }}
                    />
                    Flat all months (Discount applies to all selected months)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#fff' }}>
                    <input
                      type="radio"
                      name="discount_scope"
                      value="first_month"
                      checked={paymentConfig.discount_scope === 'first_month'}
                      onChange={() => setPaymentConfig(p => ({ ...p, discount_scope: 'first_month' }))}
                      style={{ cursor: 'pointer' }}
                    />
                    First month only (Discount applies to month 1; subsequent months at base price)
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleSavePaymentConfig}
            disabled={configSaving || configLoading}
          >
            {configSaving ? 'Saving...' : 'Save Payment Settings'}
          </button>
        </div>
      </div>

      <div className="admin-list-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0 }}>User Plans</h2>
            <button
              className="admin-btn admin-btn-primary admin-btn-small"
              onClick={() => setShowAddModal(true)}
            >
              + Create Plan Override
            </button>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Filter by Tier */}
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="setting-select"
              style={{ background: 'var(--card-bg, #1a1a1a)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px', padding: '6px 12px', height: '38px', fontSize: '13px' }}
            >
              <option value="all">All Plan Tiers</option>
              <option value="free">Free Plan</option>
              <option value="pro">Pro Plan</option>
            </select>

            <div className="admin-search-wrapper" style={{ width: '320px' }}>
              <div className="admin-search-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search address or username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchUsers(searchQuery, tierFilter)}
              />
              <button className="admin-search-btn" onClick={() => fetchUsers(searchQuery, tierFilter)}>
                Search
              </button>
            </div>
          </div>
        </div>

        {/* Modal for adding/setting subscription */}
        {showAddModal && (
          <div className="admin-settings-card" style={{ marginBottom: '24px', border: '1px solid rgba(205, 161, 105, 0.4)', background: 'rgba(205, 161, 105, 0.03)' }}>
            <h3>Create/Override User Plan</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div className="admin-form-group">
                <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Wallet Address</label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '20px' }}>
                <div className="admin-form-group">
                  <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Plan Tier</label>
                  <select
                    value={newTier}
                    onChange={(e) => setNewTier(e.target.value as any)}
                    className="setting-select"
                    style={{ width: '100%', marginTop: '4px' }}
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro ($5/mo)</option>
                  </select>
                </div>

                {newTier !== 'free' && (
                  <div className="admin-form-group">
                    <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Expiry Date (Optional)</label>
                    <input
                      type="datetime-local"
                      value={newExpiresAt}
                      onChange={(e) => setNewExpiresAt(e.target.value)}
                      style={{ width: '100%', marginTop: '4px' }}
                    />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <button type="button" className="admin-chip" onClick={() => setExpiryPreset('month', 'new')}>+1 Month</button>
                      <button type="button" className="admin-chip" onClick={() => setExpiryPreset('year', 'new')}>+1 Year</button>
                      <button type="button" className="admin-chip" onClick={() => setExpiryPreset('never', 'new')}>Never</button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={() => handleUpdateSubscription(newAddress, newTier, newTier === 'free' ? null : newExpiresAt, true)}
                  disabled={addLoading || !newAddress.startsWith('0x')}
                >
                  {addLoading ? 'Processing...' : 'Apply Plan'}
                </button>
                <button
                  className="admin-btn admin-btn-secondary"
                  onClick={() => { setShowAddModal(false); setNewAddress(''); setNewExpiresAt(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {message.text && (
          <div className={`admin-message ${message.type}`} style={{ marginBottom: '20px' }}>
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="admin-empty-state">Loading plans database...</div>
        ) : users.length === 0 ? (
          <div className="admin-empty-state">No users found.</div>
        ) : (
          <div className="admin-list">
            {users.map(user => {
              const isEditing = editingAddress === user.wallet_address;
              const userTier = user.subscription_tier || 'free';
              const displayTier = userTier === 'lite' ? 'pro' : userTier;

              return (
                <div key={user.wallet_address} className="admin-list-item" style={{ border: isEditing ? '1px solid rgba(205, 161, 105, 0.5)' : '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="admin-item-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div className="admin-item-title" style={{ gap: '12px' }}>
                        <img
                          src={user.avatar_url || '/pfp/default.png'}
                          alt=""
                          className="admin-badge-image"
                          style={{ borderRadius: '50%', width: '40px', height: '40px' }}
                        />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong>{user.username || 'Anonymous'}</strong>
                            <span className={`current-plan-badge`} style={{
                              background: displayTier === 'pro' ? 'rgba(139, 92, 246, 0.12)' : 'rgba(255,255,255,0.05)',
                              color: displayTier === 'pro' ? '#a78bfa' : '#888',
                              border: displayTier === 'pro' ? '1px solid rgba(139, 92, 246, 0.2)' : '1px solid rgba(255,255,255,0.1)'
                            }}>
                              {displayTier.toUpperCase()}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            <code>{user.wallet_address}</code>
                          </div>
                        </div>
                      </div>

                      {!isEditing && (
                        <div className="admin-item-actions">
                          <button
                            className="admin-btn admin-btn-secondary admin-btn-small"
                            onClick={() => startEditing(user)}
                            disabled={actionLoading !== null}
                          >
                            Edit Plan
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Edit Form */}
                    {isEditing ? (
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', marginTop: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '13px' }}>Modify Plan</h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                          <div className="admin-form-group" style={{ flex: 1, minWidth: '150px' }}>
                            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Plan Tier</label>
                            <select
                              value={editTier}
                              onChange={(e) => setEditTier(e.target.value as any)}
                              className="setting-select"
                              style={{ width: '100%', marginTop: '4px' }}
                            >
                              <option value="free">Free</option>
                              <option value="pro">Pro ($5/mo)</option>
                            </select>
                          </div>

                          {editTier !== 'free' && (
                            <div className="admin-form-group" style={{ flex: 2, minWidth: '220px' }}>
                              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Expiry Date (Optional)</label>
                              <input
                                type="datetime-local"
                                value={editExpiresAt}
                                onChange={(e) => setEditExpiresAt(e.target.value)}
                                style={{ width: '100%', marginTop: '4px' }}
                              />
                              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                                <button type="button" className="admin-chip" onClick={() => setExpiryPreset('month', 'edit')}>+1 Month</button>
                                <button type="button" className="admin-chip" onClick={() => setExpiryPreset('year', 'edit')}>+1 Year</button>
                                <button type="button" className="admin-chip" onClick={() => setExpiryPreset('never', 'edit')}>Never</button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                          <button
                            className="admin-btn admin-btn-primary admin-btn-small"
                            onClick={() => handleUpdateSubscription(user.wallet_address, editTier, editTier === 'free' ? null : editExpiresAt)}
                            disabled={actionLoading === user.wallet_address}
                          >
                            {actionLoading === user.wallet_address ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button
                            className="admin-btn admin-btn-secondary admin-btn-small"
                            onClick={() => setEditingAddress(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.01)', padding: '8px 12px', borderRadius: '6px' }}>
                        <div>
                          Started: <span style={{ color: 'rgba(255,255,255,0.7)' }}>{user.subscription_started_at ? new Date(user.subscription_started_at).toLocaleDateString() : 'N/A'}</span>
                        </div>
                        <div>
                          Expires: <span style={{ color: 'rgba(255,255,255,0.7)' }}>{formatDate(user.subscription_expires_at)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
