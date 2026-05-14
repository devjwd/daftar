import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { syncEntities } from '../services/entityStore';
import { manageEntity } from '../services/api';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { createAdminProofHeaders } from '../services/adminProof';
import styles from './EntityAdmin.module.css';

const CATEGORIES = ['Protocol', 'Treasury', 'Swap', 'Dex', 'Lending', 'Staking', 'Bridge', 'Exchange', 'Venture', 'Airdrop'];

export default function EntityAdmin() {
  const { account, signMessage } = useWallet();
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [labelCount, setLabelCount] = useState(0);
  const [isAddingLabel, setIsAddingLabel] = useState(false);
  const [submittingLabel, setSubmittingLabel] = useState(false);
  
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlStatus, setCrawlStatus] = useState('');
  const [selectedExchangeId, setSelectedExchangeId] = useState('all');

  const [labelFormData, setLabelFormData] = useState({
    address: '',
    entity_id: '',
    label_name: ''
  });

  const [formData, setFormData] = useState({
    address: '',
    name: '',
    category: 'Protocol',
    logo_url: '',
    website_url: '',
    twitter_url: '',
    custom_type: '',
    badge_color: '#9ca3af',
    is_verified: true
  });

  const [message, setMessage] = useState({ text: '', type: '' });

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tracked_entities')
        .select('*')
        .order('name');

      if (error) throw error;
      setEntities(data || []);
    } catch (err) {
      console.error('Error fetching entities:', err);
      setMessage({ text: 'Failed to load entities', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLabels = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from('address_labels')
        .select('*', { count: 'exact', head: true });

      if (!error && count !== null) {
        setLabelCount(count);
      }
    } catch (err) {
      console.error('Error fetching labels:', err);
    }
  }, []);

  useEffect(() => {
    fetchEntities();
    fetchLabels();
  }, [fetchEntities, fetchLabels]);

  const runLocalCrawl = async () => {
    if (isCrawling) return;
    
    let exchanges = entities.filter(e => e.category === 'Exchange');
    if (selectedExchangeId !== 'all') {
      exchanges = exchanges.filter(e => e.id === selectedExchangeId);
    }

    if (exchanges.length === 0) return setMessage({ text: 'No exchange entities found for crawling', type: 'error' });

    setIsCrawling(true);
    setMessage({ text: `Starting network crawl for ${exchanges.length === 1 ? exchanges[0].name : 'all exchanges'}...`, type: 'info' });

    const knownAddresses = new Set(entities.map(e => e.address.toLowerCase()));
    let totalFound = 0;

    try {
      for (const exchange of exchanges) {
        setCrawlStatus(`Crawling ${exchange.name}...`);
        let ltVersion: string | null = "9223372036854775807";
        let hasMore = true;
        let checkedTxs = 0;
        const allDiscoveredForExchange = [];

        while (hasMore) {
          setCrawlStatus(`Crawling ${exchange.name}... Checked ${checkedTxs} txs. Discovered ${totalFound} addresses`);
          const res = await fetch((import.meta as any).env.VITE_MOVEMENT_INDEXER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: `query Crawl($addr: String!, $lt: bigint) {
                account_transactions(where: { account_address: { _eq: $addr }, transaction_version: { _lt: $lt } }, order_by: { transaction_version: desc }, limit: 50) {
                  transaction_version
                  user_transaction { sender }
                }
              }`,
              variables: { addr: exchange.address, lt: ltVersion }
            })
          });

          const json = await res.json();
          const txs = json.data?.account_transactions || [];
          if (txs.length === 0) {
            hasMore = false;
            break;
          }

          checkedTxs += txs.length;
          setCrawlStatus(`Crawling ${exchange.name}... Checked ${checkedTxs} txs. Discovered ${totalFound} addresses`);

          for (const tx of txs) {
            const sender = tx.user_transaction?.sender?.toLowerCase();
            if (sender && sender !== exchange.address.toLowerCase() && !knownAddresses.has(sender)) {
              allDiscoveredForExchange.push({
                address: sender,
                entity_id: exchange.id,
                label_name: `${exchange.name} Deposit Address`,
                discovery_method: 'browser_crawl'
              });
              knownAddresses.add(sender); // Don't re-label same address in this session
              totalFound++;
            }
          }

          ltVersion = txs[txs.length - 1].transaction_version;
          if (txs.length < 50) hasMore = false;
          await new Promise(r => setTimeout(r, 200));
        }

        if (allDiscoveredForExchange.length > 0) {
          setCrawlStatus(`Saving ${allDiscoveredForExchange.length} addresses for ${exchange.name}... (Please approve signature in your wallet)`);
          const body = { labels: allDiscoveredForExchange, action: 'manage-labels', method: 'POST' };
          const auth = await createAuth('manage-labels', body);
          const apiRes = await fetch((import.meta as any).env.VITE_API_URL + '/api/admin/manage-badge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth },
            body: JSON.stringify(body)
          });
          if (!apiRes.ok) throw new Error('Failed to save bulk labels');
        }
      }
      setMessage({ text: `Crawl complete! Found ${totalFound} new deposit addresses.`, type: 'success' });
      fetchLabels();
    } catch (err: any) {
      console.error('Crawl error:', err);
      setMessage({ text: 'Crawl interrupted: ' + err.message, type: 'error' });
    } finally {
      setIsCrawling(false);
      setCrawlStatus('');
    }
  };

  const handleEdit = (entity) => {
    setEditingId(entity.id);
    setFormData({
      address: entity.address,
      name: entity.name,
      category: entity.category || 'Protocol',
      logo_url: entity.logo_url || '',
      website_url: entity.website_url || '',
      twitter_url: entity.twitter_url || '',
      custom_type: entity.custom_type || '',
      badge_color: entity.badge_color || '#9ca3af',
      is_verified: !!entity.is_verified
    });
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const createAuth = useCallback(async (action, body) => {
    if (!account || !signMessage) throw new Error('Connect admin wallet');
    return await createAdminProofHeaders({
      account,
      signMessage,
      action,
      body
    });
  }, [account, signMessage]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!account) return setMessage({ text: 'Please connect wallet', type: 'error' });

    setSubmitting(true);
    setMessage({ text: 'Saving...', type: 'info' });

    try {
      let addr = formData.address.trim().toLowerCase();
      if (addr && !addr.startsWith('0x')) addr = '0x' + addr;

      const payload: any = { ...formData, address: addr };
      if (editingId) payload.id = editingId;

      const auth = await createAuth('manage-entities', { action: 'manage-entities', method: 'POST', entity: payload });
      const result = await manageEntity('POST', payload, auth);

      if (!result.ok) throw new Error(result.error || 'Failed to save entity');

      const savedEntity = result.data?.entity || { ...payload, id: result.data?.id || editingId };
      if (editingId) {
        setEntities(prev => prev.map(e => e.id === editingId ? savedEntity : e));
      } else {
        setEntities(prev => [...prev, savedEntity].sort((a, b) => a.name.localeCompare(b.name)));
      }

      await syncEntities(true);
      setMessage({ text: `Successfully ${editingId ? 'updated' : 'added'} entity`, type: 'success' });
      setIsAdding(false);
      setFormData({
        address: '', name: '', category: 'Protocol', logo_url: '',
        website_url: '', twitter_url: '', custom_type: '',
        badge_color: '#9ca3af', is_verified: true
      });
    } catch (err) {
      console.error('Error saving entity:', err);
      setMessage({ text: err.message || 'Error saving entity', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this entity mapping?')) return;
    if (!account) return setMessage({ text: 'Please connect wallet', type: 'error' });

    setMessage({ text: 'Deleting...', type: 'info' });
    try {
      const auth = await createAuth('manage-entities', { action: 'manage-entities', method: 'DELETE', id });
      const result = await manageEntity('DELETE', { id }, auth);

      if (!result.ok) throw new Error(result.error || 'Failed to delete entity');

      setEntities(prev => prev.filter(e => e.id !== id));
      await syncEntities(true);
      setMessage({ text: 'Entity deleted successfully', type: 'success' });
    } catch (err) {
      console.error('[EntityAdmin] Delete failed:', err);
      setMessage({ text: `Delete failed: ${err.message}`, type: 'error' });
    }
  };

  return (
    <div className={styles.entityAdmin}>
      <header className={styles.header}>
        <div className={styles.headerInfo}>
          <h2>Entity Wallets</h2>
          <p>Map wallet addresses to recognizable names in the UI.</p>
        </div>
        <button
          className={styles.addBtn}
          onClick={() => {
            setIsAdding(!isAdding);
            setEditingId(null);
            setFormData({
              address: '', name: '', category: 'Protocol', logo_url: '',
              website_url: '', twitter_url: '', is_verified: true,
              custom_type: '', badge_color: '#9ca3af'
            });
          }}
        >
          {isAdding ? 'Cancel' : '+ Add Entity'}
        </button>
      </header>

      {message.text && (
        <div className={`${styles.alert} ${styles[message.type]}`}>
          {message.text}
        </div>
      )}

      {isAdding && (
        <form className={styles.formCard} onSubmit={handleSubmit}>
          <h3>{editingId ? 'Edit Entity' : 'Register New Entity'}</h3>
          <div className={styles.formGrid}>
            <div className={styles.inputGroup}>
              <label>Wallet Address</label>
              <input
                type="text"
                required
                placeholder="0x..."
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Entity Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Movement Treasury"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Category (Entity Classification)</label>
              <select
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className={styles.inputGroup}>
              <label>Special Transaction Tag (Badge Label)</label>
              <input
                type="text"
                placeholder="e.g. CASHBACK, REWARD, MINT"
                value={formData.custom_type || ''}
                onChange={e => setFormData({ ...formData, custom_type: e.target.value })}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Badge Color</label>
              <div className={styles.colorPickerWrap}>
                <input
                  type="color"
                  value={formData.badge_color || '#9ca3af'}
                  onChange={e => setFormData({ ...formData, badge_color: e.target.value })}
                  className={styles.colorPicker}
                />
                <input
                  type="text"
                  value={formData.badge_color || '#9ca3af'}
                  onChange={e => setFormData({ ...formData, badge_color: e.target.value })}
                  className={styles.colorHexInput}
                  placeholder="#FFFFFF"
                />
              </div>
            </div>
            <div className={styles.inputGroup}>
              <label>Logo URL (optional)</label>
              <input
                type="text"
                placeholder="https://..."
                value={formData.logo_url}
                onChange={e => setFormData({ ...formData, logo_url: e.target.value })}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Website (optional)</label>
              <input
                type="text"
                placeholder="https://..."
                value={formData.website_url}
                onChange={e => setFormData({ ...formData, website_url: e.target.value })}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>X (Twitter) URL</label>
              <input
                type="text"
                placeholder="https://x.com/..."
                value={formData.twitter_url}
                onChange={e => setFormData({ ...formData, twitter_url: e.target.value })}
              />
            </div>
            <div className={styles.checkboxGroup}>
              <label>
                <input
                  type="checkbox"
                  checked={formData.is_verified}
                  onChange={e => setFormData({ ...formData, is_verified: e.target.checked })}
                />
                Is Verified Entity
              </label>
            </div>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className={styles.saveBtn} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Entity'}
            </button>
          </div>
        </form>
      )}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Address</th>
              <th>Category</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className={styles.center}>Loading...</td></tr>
            ) : entities.length === 0 ? (
              <tr><td colSpan={5} className={styles.center}>No entities registered.</td></tr>
            ) : entities.map(entity => (
              <tr key={entity.id}>
                <td>
                  <div className={styles.entityCell}>
                    <img
                      src={entity.logo_url || '/movement-logo.svg'}
                      alt=""
                      onError={(e) => (e.currentTarget as HTMLImageElement).src = '/movement-logo.svg'}
                    />
                    <span>{entity.name}</span>
                  </div>
                </td>
                <td><code className={styles.code}>{entity.address.slice(0, 10)}...{entity.address.slice(-6)}</code></td>
                <td><span className={styles.categoryTag}>{entity.category}</span></td>
                <td>
                  {entity.is_verified ? (
                    <span className={styles.statusVerified}>✅ Verified</span>
                  ) : (
                    <span className={styles.statusUnverified}>Unverified</span>
                  )}
                </td>
                <td>
                  <div className={styles.actions}>
                    <button onClick={() => handleEdit(entity)}>Edit</button>
                    <button className={styles.deleteBtn} onClick={() => handleDelete(entity.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <header className={styles.header} style={{ marginTop: '48px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '32px' }}>
        <div className={styles.headerInfo}>
          <h2>Detected Deposit Addresses ({labelCount})</h2>
          <p>Addresses tagged by the heuristic engine or manually added.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {isCrawling && (
            <div style={{ fontSize: '12px', color: '#cda169', fontWeight: '600', animation: 'pulse 2s infinite' }}>
              {crawlStatus}
            </div>
          )}
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <label style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '1px' }}>Target:</label>
            <select 
              value={selectedExchangeId} 
              onChange={e => setSelectedExchangeId(e.target.value)}
              disabled={isCrawling}
              style={{ background: 'transparent', color: '#cda169', border: 'none', fontSize: '13px', outline: 'none', cursor: 'pointer' }}
            >
              <option value="all">All Exchanges</option>
              {entities.filter(e => e.category === 'Exchange').map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <button
            className={styles.addBtn}
            onClick={runLocalCrawl}
            disabled={isCrawling}
            style={{ 
              background: 'rgba(205, 161, 105, 0.1)', 
              color: '#cda169', 
              border: '1px solid rgba(205, 161, 105, 0.3)',
              cursor: isCrawling ? 'not-allowed' : 'pointer'
            }}
          >
            {isCrawling ? '⚡ Scanning...' : '🔄 Sync & Extract'}
          </button>
          <button
            className={styles.addBtn}
            onClick={() => {
              setIsAddingLabel(!isAddingLabel);
              setLabelFormData({ address: '', entity_id: '', label_name: '' });
            }}
          >
            {isAddingLabel ? 'Cancel' : '+ Add Address Label'}
          </button>
        </div>
      </header>

      {isAddingLabel && (
        <form className={styles.formCard} onSubmit={async (e) => {
          e.preventDefault();
          if (!account) return setMessage({ text: 'Please connect wallet', type: 'error' });
          setSubmittingLabel(true);
          try {
            const payload = { label: labelFormData, action: 'manage-labels', method: 'POST' };
            const auth = await createAuth('manage-labels', payload);
            const res = await fetch((import.meta as any).env?.VITE_API_URL + '/api/admin/manage-badge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...auth },
              body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save label');
            setIsAddingLabel(false);
            setLabelFormData({ address: '', entity_id: '', label_name: '' });
            setMessage({ text: 'Label added successfully', type: 'success' });
            fetchLabels();
          } catch (err: any) {
            setMessage({ text: err.message, type: 'error' });
          } finally {
            setSubmittingLabel(false);
          }
        }}>
          <h3>Register Address Label</h3>
          <div className={styles.formGrid}>
            <div className={styles.inputGroup}>
              <label>Deposit Wallet Address</label>
              <input type="text" required placeholder="0x..." value={labelFormData.address} onChange={e => setLabelFormData({...labelFormData, address: e.target.value})} />
            </div>
            <div className={styles.inputGroup}>
              <label>Hub Entity (Exchange)</label>
              <select required value={labelFormData.entity_id} onChange={e => setLabelFormData({...labelFormData, entity_id: e.target.value})}>
                <option value="">-- Select Entity --</option>
                {entities.filter(e => e.category === 'Exchange' || e.category === 'Treasury').map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.category})</option>
                ))}
              </select>
            </div>
            <div className={styles.inputGroup}>
              <label>Label Name</label>
              <input type="text" required placeholder="e.g. Binance Deposit Address" value={labelFormData.label_name} onChange={e => setLabelFormData({...labelFormData, label_name: e.target.value})} />
            </div>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className={styles.saveBtn} disabled={submittingLabel}>
              {submittingLabel ? 'Saving...' : 'Save Label'}
            </button>
          </div>
        </form>
      )}

        </form>
      )}
    </div>
  );
}
