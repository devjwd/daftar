import React, { useState, useEffect, useCallback } from 'react';
import { 
  getAllowlistStats, 
  searchAllowlist, 
  importAllowlist, 
  removeFromAllowlist, 
  clearAllowlist 
} from '../../services/badgeApi.js';
import { createAdminProofHeaders } from '../../services/adminProof.js';

export default function AllowlistEditor({ badge, account, onClose, showMessage }) {
  const [stats, setStats] = useState({ count: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const createAuth = useCallback(async (action, payload = {}) => {
    if (!account || !window.aptos?.signMessage) throw new Error('Wallet not ready');
    return await createAdminProofHeaders({
      account,
      signMessage: (args) => window.aptos.signMessage(args),
      action: 'import-allowlist',
      body: { badge_id: badge.id, ...payload, action }
    });
  }, [account, badge.id]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await createAuth('stats');
      const res = await getAllowlistStats(badge.id, auth);
      if (res.ok) setStats(res.data);
    } catch (err) {
      console.error('Failed to load stats', err);
    } finally {
      setLoading(false);
    }
  }, [badge.id, createAuth]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleSearch = async () => {
    if (!searchQuery.startsWith('0x') || searchQuery.length < 60) {
      showMessage('error', 'Please enter a valid wallet address');
      return;
    }
    setLoading(true);
    try {
      const auth = await createAuth('search', { wallet_address: searchQuery });
      const res = await searchAllowlist(badge.id, searchQuery, auth);
      setSearchResult(res.ok ? res.data : { found: false, error: res.data?.error });
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setSubmitting(true);
    try {
      const text = await file.text();
      const found = text.match(/0x[a-fA-F0-9]{64}/g) || [];
      const addresses = [...new Set(found.map(a => a.toLowerCase()))];
      
      if (addresses.length === 0) throw new Error('No valid addresses found in file');
      
      showMessage('info', `Uploading ${addresses.length} addresses...`);
      const auth = await createAuth('import', { addresses });
      const res = await importAllowlist(badge.id, addresses, auth);
      
      if (res.ok) {
        showMessage('success', `Successfully imported ${res.data.imported} addresses`);
        loadStats();
      } else {
        throw new Error(res.data?.error || 'Import failed');
      }
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Are you absolutely sure? This will wipe the entire allowlist for this badge.')) return;
    
    setSubmitting(true);
    try {
      const auth = await createAuth('clear');
      const res = await clearAllowlist(badge.id, auth);
      if (res.ok) {
        showMessage('success', 'Allowlist cleared');
        loadStats();
      } else {
        throw new Error(res.data?.error);
      }
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ba-modal-overlay">
      <div className="ba-allowlist-modal">
        <div className="ba-modal-header">
          <h3>Manage Allowlist: {badge.name}</h3>
          <button className="ba-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="ba-modal-body">
          <div className="ba-stats-card">
            <div className="ba-stat-val">{loading ? '...' : stats.count}</div>
            <div className="ba-stat-label">Total Wallets Eligible</div>
          </div>

          <div className="ba-editor-section">
            <label>Add New Wallets (Append)</label>
            <div className="ba-upload-box">
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload} disabled={submitting} id="mgr-file-up" style={{ display: 'none' }} />
              <label htmlFor="mgr-file-up" className="ba-file-label">
                {submitting ? '🔄 Processing...' : '📁 Click to upload CSV or TXT'}
              </label>
              <p className="ba-hint">Upload will deduplicate against existing list automatically.</p>
            </div>
          </div>

          <div className="ba-editor-section">
            <label>Search / Verify Wallet</label>
            <div className="ba-search-row">
              <input 
                type="text" 
                placeholder="0x..." 
                value={searchQuery} 
                onChange={e => setSearchQuery(e.target.value)}
                className="ba-input"
              />
              <button className="ba-btn ba-btn-primary" onClick={handleSearch} disabled={loading}>Search</button>
            </div>
            {searchResult && (
              <div className={`ba-search-feedback ${searchResult.found ? 'found' : 'missing'}`}>
                {searchResult.found ? '✅ This wallet IS on the list.' : '❌ This wallet IS NOT on the list.'}
              </div>
            )}
          </div>
        </div>

        <div className="ba-modal-footer">
          <button className="ba-btn ba-btn-danger" onClick={handleClear} disabled={submitting}>Wipe Allowlist</button>
          <button className="ba-btn ba-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
