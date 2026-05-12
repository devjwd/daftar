import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { manageUserVerification } from '../services/api';
import { createAdminProofHeaders } from '../services/adminProof';

interface UserProfile {
  wallet_address: string;
  username: string;
  is_verified: boolean;
  avatar_url?: string;
  created_at: string;
}

export default function UserVerificationAdmin() {
  const { account, signMessage } = useWallet();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const showMessage = (type: string, text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  const createAuth = useCallback(async (body: any) => {
    if (!account || !signMessage) throw new Error('Wallet not ready');
    return await createAdminProofHeaders({
      account,
      signMessage,
      action: 'manage-users',
      body
    });
  }, [account, signMessage]);

  const fetchUsers = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const body = { method: 'LIST', query };
      const auth = await createAuth(body);
      const res = await manageUserVerification(body as any, auth);
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
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleVerification = async (user: UserProfile | { wallet_address: string, is_verified: boolean, username?: string }) => {
    const isNew = !('created_at' in user);
    if (!isNew) setActionLoading(user.wallet_address);
    else setAddLoading(true);

    try {
      const body = { 
        method: 'TOGGLE_VERIFICATION', 
        address: user.wallet_address, 
        verified: !user.is_verified 
      };
      const auth = await createAuth(body);
      const res = await manageUserVerification(body as any, auth);
      
      if (res.ok) {
        showMessage('success', `User ${user.username || user.wallet_address.slice(0, 8)} ${!user.is_verified ? 'verified' : 'unverified'} successfully`);
        
        if (isNew) {
          setNewAddress('');
          setShowAddModal(false);
          fetchUsers(searchQuery);
        } else {
          // Update local state
          setUsers(prev => prev.map(u => 
            u.wallet_address === user.wallet_address 
              ? { ...u, is_verified: !user.is_verified } 
              : u
          ));
        }
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

  return (
    <div className="admin-content">
      <div className="admin-list-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0 }}>User Verification</h2>
            <button 
              className="admin-btn admin-btn-primary admin-btn-small" 
              onClick={() => setShowAddModal(true)}
            >
              + Add User
            </button>
          </div>
          
          <div className="admin-search-wrapper" style={{ width: '400px' }}>
            <div className="admin-search-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <input 
              type="text" 
              placeholder="Search by address or username..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchUsers(searchQuery)}
            />
            <button className="admin-search-btn" onClick={() => fetchUsers(searchQuery)}>
              Search
            </button>
          </div>
        </div>

        {showAddModal && (
          <div className="admin-settings-card" style={{ marginBottom: '24px', border: '1px solid var(--text-secondary)' }}>
            <h3>Verify New User</h3>
            <div className="admin-form-group">
              <label>Wallet Address</label>
              <div className="admin-inline-input">
                <input 
                  type="text" 
                  placeholder="0x..." 
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                />
                <button 
                  className="admin-btn admin-btn-primary" 
                  onClick={() => handleToggleVerification({ wallet_address: newAddress, is_verified: false })}
                  disabled={addLoading || !newAddress.startsWith('0x')}
                >
                  {addLoading ? 'Verifying...' : 'Verify User'}
                </button>
                <button 
                  className="admin-btn admin-btn-secondary" 
                  onClick={() => { setShowAddModal(false); setNewAddress(''); }}
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
          <div className="admin-empty-state">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="admin-empty-state">No users found.</div>
        ) : (
          <div className="admin-list">
            {users.map(user => (
              <div key={user.wallet_address} className="admin-list-item">
                <div className="admin-item-header">
                  <div className="admin-item-title">
                    {user.avatar_url && (
                      <img src={user.avatar_url} alt="" className="admin-badge-image" style={{ borderRadius: '50%' }} />
                    )}
                    <div>
                      <strong>{user.username || 'Anonymous'}</strong>
                      {user.is_verified && <span style={{ marginLeft: '8px', color: '#3b82f6' }}>✅ Verified</span>}
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        <code>{user.wallet_address}</code>
                      </div>
                    </div>
                  </div>
                  <div className="admin-item-actions">
                    <button 
                      className={`admin-btn ${user.is_verified ? 'admin-btn-secondary' : 'admin-btn-primary'}`}
                      onClick={() => handleToggleVerification(user)}
                      disabled={actionLoading === user.wallet_address}
                    >
                      {actionLoading === user.wallet_address 
                        ? 'Processing...' 
                        : user.is_verified ? 'Unverify User' : 'Verify User'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
