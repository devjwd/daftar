import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { syncEntities } from '../services/entityStore';
import styles from './EntityAdmin.module.css';

const CATEGORIES = ['Protocol', 'Treasury', 'Swap', 'Dex', 'Lending', 'Staking', 'Bridge', 'Exchange', 'Venture', 'Airdrop'];

export default function EntityAdmin() {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
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

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: 'Saving...', type: 'info' });

    try {
      // Normalize address
      let addr = formData.address.trim().toLowerCase();
      if (addr && !addr.startsWith('0x')) addr = '0x' + addr;

      const payload = {
        ...formData,
        address: addr
      };
      
      if (editingId) {
        payload.id = editingId;
      }

      const response = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'Failed to save entity');
      }

      // Refresh dynamic entity cache
      await syncEntities(true);

      setMessage({ text: `Successfully ${editingId ? 'updated' : 'added'} entity`, type: 'success' });
      setIsAdding(false);
      setFormData({ 
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
      fetchEntities();
    } catch (err) {
      console.error('Error saving entity:', err);
      let errorMsg = err.message || 'Error saving entity';
      if (err.code === '42501') {
        errorMsg = 'Permission denied: Only administrators can manage entities. Please ensure you are logged in with the admin wallet.';
      }
      setMessage({ text: errorMsg, type: 'error' });
    }
  };

  const handleEdit = (entity) => {
    setFormData({
      address: entity.address,
      name: entity.name,
      category: entity.category,
      logo_url: entity.logo_url || '',
      website_url: entity.website_url || '',
      twitter_url: entity.twitter_url || '',
      custom_type: entity.custom_type || '',
      badge_color: entity.badge_color || '#9ca3af',
      is_verified: entity.is_verified
    });
    setEditingId(entity.id);
    setIsAdding(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this entity mapping?')) return;

    try {
       const response = await fetch(`/api/entities/${id}`, {
         method: 'DELETE'
       });
       
       const result = await response.json();
       if (!response.ok || !result.ok) {
         throw new Error(result.error || 'Failed to delete entity');
       }

       // Refresh dynamic entity cache
       await syncEntities(true);

       setMessage({ text: 'Entity deleted', type: 'success' });
       fetchEntities();
    } catch (err) {
      setMessage({ text: 'Failed to delete', type: 'error' });
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
            setFormData({ address: '', name: '', category: 'Protocol', logo_url: '', website_url: '', twitter_url: '', is_verified: true });
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
                onChange={e => setFormData({...formData, address: e.target.value})}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Entity Name</label>
              <input 
                type="text" 
                required 
                placeholder="e.g. Movement Treasury"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Category (Entity Classification)</label>
              <select 
                value={formData.category}
                onChange={e => setFormData({...formData, category: e.target.value})}
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
                onChange={e => setFormData({...formData, custom_type: e.target.value})}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Badge Color</label>
              <div className={styles.colorPickerWrap}>
                <input 
                  type="color" 
                  value={formData.badge_color || '#9ca3af'}
                  onChange={e => setFormData({...formData, badge_color: e.target.value})}
                  className={styles.colorPicker}
                />
                <input 
                  type="text" 
                  value={formData.badge_color || '#9ca3af'}
                  onChange={e => setFormData({...formData, badge_color: e.target.value})}
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
                onChange={e => setFormData({...formData, logo_url: e.target.value})}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Website (optional)</label>
              <input 
                type="text" 
                placeholder="https://..."
                value={formData.website_url}
                onChange={e => setFormData({...formData, website_url: e.target.value})}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>X (Twitter) URL</label>
              <input 
                type="text" 
                placeholder="https://x.com/..."
                value={formData.twitter_url}
                onChange={e => setFormData({...formData, twitter_url: e.target.value})}
              />
            </div>
            <div className={styles.checkboxGroup}>
              <label>
                <input 
                  type="checkbox" 
                  checked={formData.is_verified}
                  onChange={e => setFormData({...formData, is_verified: e.target.checked})}
                />
                Is Verified Entity
              </label>
            </div>
          </div>
          <div className={styles.formActions}>
             <button type="submit" className={styles.saveBtn}>Save Entity</button>
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
              <tr><td colSpan="5" className={styles.center}>Loading...</td></tr>
            ) : entities.length === 0 ? (
              <tr><td colSpan="5" className={styles.center}>No entities registered.</td></tr>
            ) : entities.map(entity => (
              <tr key={entity.id}>
                <td>
                  <div className={styles.entityCell}>
                    <img src={entity.logo_url || '/movement-logo.svg'} alt="" onError={(e) => e.target.src = '/movement-logo.svg'} />
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
    </div>
  );
}
