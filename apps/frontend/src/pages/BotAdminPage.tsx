import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Settings, Save, AlertCircle, CheckCircle2, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { getEnv } from '../config/envValidator';
import './BotAdminPage.css';

const BotAdminPage: React.FC = () => {
  const API_URL = getEnv('VITE_API_URL', 'http://localhost:3001');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [config, setConfig] = useState({
    guild_name: '',
    verified_role_id: '',
    pro_role_id: '',
    modlogs_channel_id: '',
    support_category_id: ''
  });

  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.search).get('token');

  useEffect(() => {
    if (!token) {
      setError('No magic link token provided. Please run /dashboard in your Discord server.');
      setLoading(false);
      return;
    }

    const fetchConfig = async () => {
      try {
        const res = await fetch(`${API_URL}/api/bot/admin/config`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) {
          throw new Error('Invalid or expired token. Please run /dashboard again.');
        }

        const data = await res.json();
        setConfig({
          guild_name: data.guild_name || '',
          verified_role_id: data.verified_role_id || '',
          pro_role_id: data.pro_role_id || '',
          modlogs_channel_id: data.modlogs_channel_id || '',
          support_category_id: data.support_category_id || ''
        });
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [token]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`${API_URL}/api/bot/admin/config`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(config)
      });

      if (!res.ok) {
        throw new Error('Failed to save configuration');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '2rem', height: '2rem', border: '2px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error && !token) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '1.5rem' }}>
        <AlertCircle style={{ color: '#ff5555', marginBottom: '1rem' }} size={48} />
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Access Denied</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', maxWidth: '400px' }}>
          You need a secure magic link to access the dashboard.
          Type <code style={{ background: 'var(--card-bg)', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>/dashboard</code> in your Discord server to generate one!
        </p>
        <button onClick={() => navigate('/bot')} className="bot-admin-btn">
          Learn More
        </button>
      </div>
    );
  }

  return (
    <div className="bot-admin-container">
      <button 
        onClick={() => navigate('/bot')}
        style={{ display: 'flex', alignItems: 'center', color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '2rem' }}
      >
        <ChevronLeft size={20} />
        Back to Bot Info
      </button>

      <div className="bot-admin-header" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ width: '3rem', height: '3rem', background: 'rgba(212,175,55,0.1)', color: 'var(--primary)', borderRadius: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Settings size={24} />
        </div>
        <div>
          <h1 className="bot-admin-title">Server Configuration</h1>
          <p className="bot-admin-subtitle">Configure the Daftar Bot for {config.guild_name ? `"${config.guild_name}"` : 'your server'}</p>
        </div>
      </div>

      {error && (
        <div className="bot-admin-error">
          <AlertCircle size={20} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
          {error}
        </div>
      )}

      {success && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bot-admin-success"
        >
          <CheckCircle2 size={20} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
          Configuration saved successfully!
        </motion.div>
      )}

      <div className="bot-admin-card">
        
        {/* Guild Name */}
        <div className="bot-admin-form-group">
          <label className="bot-admin-label">Server Name</label>
          <input
            type="text"
            name="guild_name"
            value={config.guild_name}
            onChange={handleChange}
            placeholder="e.g. My Web3 Community"
            className="bot-admin-input"
          />
          <p className="bot-admin-help">Just for your own reference in this dashboard.</p>
        </div>

        <div className="bot-admin-divider" />

        {/* Roles */}
        <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '1rem' }}>Roles</h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          <div className="bot-admin-form-group">
            <label className="bot-admin-label">Verified Role ID</label>
            <input
              type="text"
              name="verified_role_id"
              value={config.verified_role_id}
              onChange={handleChange}
              placeholder="e.g. 110293..."
              className="bot-admin-input"
            />
            <p className="bot-admin-help">Given when a user passes the Captcha or links any wallet.</p>
          </div>

          <div className="bot-admin-form-group">
            <label className="bot-admin-label">Pro Role ID (Optional)</label>
            <input
              type="text"
              name="pro_role_id"
              value={config.pro_role_id}
              onChange={handleChange}
              placeholder="e.g. 110294..."
              className="bot-admin-input"
            />
            <p className="bot-admin-help">Given ONLY to users with an active Daftar Premium subscription.</p>
          </div>
        </div>

        <div className="bot-admin-divider" />

        {/* Channels */}
        <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '1rem' }}>Channels & Categories</h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          <div className="bot-admin-form-group">
            <label className="bot-admin-label">Modlogs Channel ID</label>
            <input
              type="text"
              name="modlogs_channel_id"
              value={config.modlogs_channel_id}
              onChange={handleChange}
              placeholder="e.g. 110295..."
              className="bot-admin-input"
            />
            <p className="bot-admin-help">Where anti-spam warnings and /kick /ban logs are sent.</p>
          </div>

          <div className="bot-admin-form-group">
            <label className="bot-admin-label">Support Category ID</label>
            <input
              type="text"
              name="support_category_id"
              value={config.support_category_id}
              onChange={handleChange}
              placeholder="e.g. 110296..."
              className="bot-admin-input"
            />
            <p className="bot-admin-help">The Category where new Support Tickets will be created.</p>
          </div>
        </div>

        {/* Save Button */}
        <div style={{ paddingTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bot-admin-btn"
          >
            {saving ? (
              <div style={{ width: '1.25rem', height: '1.25rem', border: '2px solid #000', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            ) : (
              <Save size={20} />
            )}
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
};

export default BotAdminPage;
