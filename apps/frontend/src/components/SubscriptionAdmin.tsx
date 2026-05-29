import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { manageSubscription } from '../services/api';
import { createAdminProofHeaders } from '../services/adminProof';

interface UserProfile {
  wallet_address: string;
  username: string;
  subscription_tier: 'free' | 'lite' | 'pro';
  subscription_started_at?: string;
  subscription_expires_at?: string;
  avatar_url?: string;
  created_at: string;
}

export default function SubscriptionAdmin() {
  const { account, signMessage } = useWallet();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newTier, setNewTier] = useState<'free' | 'lite' | 'pro'>('lite');
  const [newExpiresAt, setNewExpiresAt] = useState<string>('');
  const [addLoading, setAddLoading] = useState(false);

  // States to track editing state for existing users in list
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editTier, setEditTier] = useState<'free' | 'lite' | 'pro'>('lite');
  const [editExpiresAt, setEditExpiresAt] = useState<string>('');

  const showMessage = (type: string, text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
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

  const fetchUsers = useCallback(async (query = '', filter = 'all') => {
    setLoading(true);
    try {
      const body = { method: 'LIST', query, tierFilter: filter };
      const auth = await createAuth(body);
      const res = await manageSubscription(body as any, auth);
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
    tier: 'free' | 'lite' | 'pro',
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
      const res = await manageSubscription(body as any, auth);

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

  const getTierBadgeClass = (tier: string) => {
    switch (tier) {
      case 'pro':
        return 'verified-tick'; // Gold/Purple badge mapping
      case 'lite':
        return 'exchange-label-badge'; // Gold badge mapping
      default:
        return 'address-age-text'; // Muted grey badge mapping
    }
  };

  const setExpiryPreset = (days: number, type: 'new' | 'edit') => {
    if (days === 0) {
      if (type === 'new') setNewExpiresAt('');
      else setEditExpiresAt('');
      return;
    }
    const d = new Date();
    d.setDate(d.getDate() + days);
    // Format to yyyy-MM-ddThh:mm for datetime-local input
    const formatted = d.toISOString().slice(0, 16);
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
    setEditTier(user.subscription_tier);
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
      <div className="admin-list-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0 }}>User Subscriptions</h2>
            <button 
              className="admin-btn admin-btn-primary admin-btn-small" 
              onClick={() => setShowAddModal(true)}
            >
              + Create Subscription
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
              <option value="all">All Tiers</option>
              <option value="free">Free Tier</option>
              <option value="lite">Lite Tier</option>
              <option value="pro">Pro Tier</option>
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
            <h3>Create/Override User Subscription</h3>
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
                  <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Subscription Tier</label>
                  <select
                    value={newTier}
                    onChange={(e) => setNewTier(e.target.value as any)}
                    className="setting-select"
                    style={{ width: '100%', marginTop: '4px' }}
                  >
                    <option value="free">Free</option>
                    <option value="lite">Lite ($2/mo)</option>
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
                      <button type="button" className="admin-chip" onClick={() => setExpiryPreset(30, 'new')}>+30 Days</button>
                      <button type="button" className="admin-chip" onClick={() => setExpiryPreset(365, 'new')}>+1 Year</button>
                      <button type="button" className="admin-chip" onClick={() => setExpiryPreset(0, 'new')}>Never</button>
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
                  {addLoading ? 'Processing...' : 'Apply Subscription'}
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
          <div className="admin-empty-state">Loading subscription database...</div>
        ) : users.length === 0 ? (
          <div className="admin-empty-state">No users found.</div>
        ) : (
          <div className="admin-list">
            {users.map(user => {
              const isEditing = editingAddress === user.wallet_address;
              const userTier = user.subscription_tier || 'free';

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
                              background: userTier === 'pro' ? 'rgba(139, 92, 246, 0.12)' : userTier === 'lite' ? 'rgba(205, 161, 105, 0.12)' : 'rgba(255,255,255,0.05)', 
                              color: userTier === 'pro' ? '#a78bfa' : userTier === 'lite' ? '#cda169' : '#888',
                              border: userTier === 'pro' ? '1px solid rgba(139, 92, 246, 0.2)' : userTier === 'lite' ? '1px solid rgba(205, 161, 105, 0.2)' : '1px solid rgba(255,255,255,0.1)'
                            }}>
                              {userTier.toUpperCase()}
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
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '13px' }}>Modify Subscription</h4>
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
                              <option value="lite">Lite ($2/mo)</option>
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
                                <button type="button" className="admin-chip" onClick={() => setExpiryPreset(30, 'edit')}>+30 Days</button>
                                <button type="button" className="admin-chip" onClick={() => setExpiryPreset(365, 'edit')}>+1 Year</button>
                                <button type="button" className="admin-chip" onClick={() => setExpiryPreset(0, 'edit')}>Never</button>
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
