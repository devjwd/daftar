import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { createAdminProofHeaders } from '../services/adminProof';

const API_URL = (import.meta as any).env?.VITE_API_URL || '';

interface SyncUser {
  wallet_address: string;
  username: string | null;
  subscription_tier: string;
  is_verified: boolean;
  avatar_url: string | null;
  sync_status: {
    full_history_synced: boolean;
    synced_transactions: number;
    total_transactions: number;
    last_sync_at: string | null;
    sync_error: string | null;
    last_synced_version: string | null;
  } | null;
  queue_status: {
    status: string;
    priority: number;
    error_message: string | null;
  } | null;
  unknown_count: number;
}

export default function SyncAdmin() {
  const { account, signMessage } = useWallet();
  const [users, setUsers] = useState<SyncUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

  const showMessage = (type: string, text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  const createAuth = useCallback(async (body: any) => {
    if (!account || !signMessage) throw new Error('Wallet not ready');
    return await createAdminProofHeaders({
      account,
      signMessage,
      action: 'manage-sync-status',
      body
    });
  }, [account, signMessage]);

  const fetchUsers = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const body = { action: 'manage-sync-status', method: 'LIST', query };
      const auth = await createAuth(body);
      const res = await fetch(`${API_URL}/api/admin/manage-badge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success && data.users) {
        setUsers(data.users);
      } else {
        throw new Error(data.error || 'Failed to fetch sync status');
      }
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [createAuth]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleForceSync = async (walletAddress: string) => {
    setActionLoading(walletAddress);
    try {
      const body = { action: 'manage-sync-status', method: 'FORCE_SYNC', address: walletAddress };
      const auth = await createAuth(body);
      const res = await fetch(`${API_URL}/api/admin/manage-badge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        showMessage('success', `Sync queued for ${walletAddress.slice(0, 8)}...`);
        setTimeout(() => fetchUsers(searchQuery), 2000);
      } else {
        throw new Error(data.error || 'Failed to queue sync');
      }
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReprocessUnknowns = async () => {
    setReprocessing(true);
    try {
      const body = { action: 'manage-sync-status', method: 'REPROCESS_UNKNOWNS' };
      const auth = await createAuth(body);
      const res = await fetch(`${API_URL}/api/admin/manage-badge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        showMessage('success', 'Reprocess job triggered. Check server logs for progress.');
      } else {
        throw new Error(data.error || 'Failed');
      }
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setTimeout(() => setReprocessing(false), 3000);
    }
  };

  const getSyncStatusBadge = (user: SyncUser) => {
    if (user.queue_status?.status === 'processing') {
      return { label: 'Syncing', color: '#f59e0b', icon: '🔄' };
    }
    if (user.queue_status?.status === 'pending') {
      return { label: 'Queued', color: '#8b5cf6', icon: '⏳' };
    }
    if (user.queue_status?.status === 'failed') {
      return { label: 'Failed', color: '#ef4444', icon: '❌' };
    }
    if (!user.sync_status) {
      return { label: 'Not Started', color: '#6b7280', icon: '⚪' };
    }
    if (user.sync_status.sync_error) {
      return { label: 'Error', color: '#ef4444', icon: '❌' };
    }
    if (user.sync_status.full_history_synced) {
      return { label: 'Synced', color: '#22c55e', icon: '✅' };
    }
    const synced = user.sync_status.synced_transactions || 0;
    const total = user.sync_status.total_transactions || 0;
    if (synced > 0 && total > 0) {
      return { label: `Partial (${Math.round((synced / total) * 100)}%)`, color: '#f59e0b', icon: '⚠️' };
    }
    return { label: 'Idle', color: '#6b7280', icon: '⚪' };
  };

  const totalUnknowns = users.reduce((sum, u) => sum + u.unknown_count, 0);
  const fullySynced = users.filter(u => u.sync_status?.full_history_synced).length;

  return (
    <div className="admin-content">
      <div className="admin-list-section">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0 }}>Data Sync Status</h2>
            <button
              className="admin-btn admin-btn-secondary admin-btn-small"
              onClick={handleReprocessUnknowns}
              disabled={reprocessing}
            >
              {reprocessing ? '⏳ Processing...' : '🔄 Reprocess Unknowns'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
                onKeyDown={(e) => e.key === 'Enter' && fetchUsers(searchQuery)}
              />
              <button className="admin-search-btn" onClick={() => fetchUsers(searchQuery)}>
                Search
              </button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          <div className="admin-summary-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Pro Users</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }}>{users.length}</div>
          </div>
          <div className="admin-summary-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Fully Synced</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#22c55e' }}>{fullySynced}</div>
          </div>
          <div className="admin-summary-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Pending Sync</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#f59e0b' }}>{users.length - fullySynced}</div>
          </div>
          <div className="admin-summary-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>Unknown TXs</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: totalUnknowns > 0 ? '#ef4444' : '#22c55e' }}>{totalUnknowns}</div>
          </div>
        </div>

        {message.text && (
          <div className={`admin-message ${message.type}`} style={{ marginBottom: '20px' }}>
            {message.text}
          </div>
        )}

        {/* User List */}
        {loading ? (
          <div className="admin-empty-state">Loading sync status...</div>
        ) : users.length === 0 ? (
          <div className="admin-empty-state">No pro users found.</div>
        ) : (
          <div className="admin-list">
            {users.map(user => {
              const badge = getSyncStatusBadge(user);
              const synced = user.sync_status?.synced_transactions || 0;
              const total = user.sync_status?.total_transactions || 0;
              const progress = total > 0 ? Math.round((synced / total) * 100) : 0;

              return (
                <div key={user.wallet_address} className="admin-list-item" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="admin-item-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
                    {/* Top row: User info + actions */}
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
                            <span style={{
                              fontSize: '10px',
                              padding: '2px 8px',
                              borderRadius: '100px',
                              background: `${badge.color}15`,
                              color: badge.color,
                              border: `1px solid ${badge.color}30`,
                              fontWeight: 600,
                            }}>
                              {badge.icon} {badge.label}
                            </span>
                            {user.unknown_count > 0 && (
                              <span style={{
                                fontSize: '10px',
                                padding: '2px 8px',
                                borderRadius: '100px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#ef4444',
                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                fontWeight: 600,
                              }}>
                                {user.unknown_count} unknown
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            <code>{user.wallet_address}</code>
                          </div>
                        </div>
                      </div>

                      <div className="admin-item-actions">
                        <button
                          className="admin-btn admin-btn-primary admin-btn-small"
                          onClick={() => handleForceSync(user.wallet_address)}
                          disabled={actionLoading === user.wallet_address}
                        >
                          {actionLoading === user.wallet_address ? '⏳' : '🔄'} Force Sync
                        </button>
                      </div>
                    </div>

                    {/* Progress bar + stats */}
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
                      {/* Progress bar */}
                      {total > 0 && (
                        <div style={{ marginBottom: '8px' }}>
                          <div style={{
                            width: '100%',
                            height: '6px',
                            background: 'rgba(255,255,255,0.05)',
                            borderRadius: '100px',
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              width: `${progress}%`,
                              height: '100%',
                              background: progress === 100
                                ? 'linear-gradient(90deg, #22c55e, #86efac)'
                                : 'linear-gradient(90deg, #cda169, #ffcc8d)',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>
                        <div>
                          Synced: <span style={{ color: 'rgba(255,255,255,0.7)' }}>{synced.toLocaleString()} / {total.toLocaleString()}</span>
                        </div>
                        <div>
                          Last Sync: <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                            {user.sync_status?.last_sync_at
                              ? new Date(user.sync_status.last_sync_at).toLocaleString()
                              : 'Never'}
                          </span>
                        </div>
                        <div>
                          Tier: <span style={{ color: user.subscription_tier === 'pro' ? '#a78bfa' : '#888' }}>
                            {(user.subscription_tier || 'free').toUpperCase()}
                          </span>
                        </div>
                      </div>

                      {/* Error message */}
                      {(user.sync_status?.sync_error || user.queue_status?.error_message) && (
                        <div style={{
                          marginTop: '8px',
                          padding: '8px 12px',
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.15)',
                          borderRadius: '6px',
                          fontSize: '0.7rem',
                          color: '#fca5a5',
                        }}>
                          ❌ {user.sync_status?.sync_error || user.queue_status?.error_message}
                        </div>
                      )}
                    </div>
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
