import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Settings, Save, AlertCircle, CheckCircle2, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const BotAdminPage: React.FC = () => {
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
        const res = await fetch(`${API_URL}/bot/admin/config`, {
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
      const res = await fetch(`${API_URL}/bot/admin/config`, {
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
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !token) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
        <AlertCircle className="text-red-500 mb-4" size={48} />
        <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
        <p className="text-neutral-400 mb-6 max-w-md">
          You need a secure magic link to access the dashboard.
          Type <code className="bg-card px-2 py-1 rounded">/dashboard</code> in your Discord server to generate one!
        </p>
        <button onClick={() => navigate('/bot')} className="bg-primary text-black px-6 py-2 rounded-lg font-semibold hover:bg-primary-hover transition-colors">
          Learn More
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 py-12">
      <button 
        onClick={() => navigate('/bot')}
        className="flex items-center text-neutral-400 hover:text-primary transition-colors mb-8"
      >
        <ChevronLeft size={20} />
        Back to Bot Info
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
          <Settings size={24} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-text">Server Configuration</h1>
          <p className="text-neutral-400">Configure the Daftar Bot for {config.guild_name ? `"${config.guild_name}"` : 'your server'}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl mb-8 flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {success && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-xl mb-8 flex items-center gap-3"
        >
          <CheckCircle2 size={20} />
          Configuration saved successfully!
        </motion.div>
      )}

      <div className="bg-card border border-border rounded-2xl p-6 md:p-8 space-y-6">
        
        {/* Guild Name */}
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">Server Name</label>
          <input
            type="text"
            name="guild_name"
            value={config.guild_name}
            onChange={handleChange}
            placeholder="e.g. My Web3 Community"
            className="w-full bg-background border border-border rounded-xl px-4 py-3 text-text focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-xs text-neutral-500 mt-2">Just for your own reference in this dashboard.</p>
        </div>

        <hr className="border-border my-6" />

        {/* Roles */}
        <h3 className="text-xl font-semibold text-text mb-4">Roles</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Verified Role ID</label>
            <input
              type="text"
              name="verified_role_id"
              value={config.verified_role_id}
              onChange={handleChange}
              placeholder="e.g. 110293..."
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-text focus:outline-none focus:border-primary font-mono text-sm"
            />
            <p className="text-xs text-neutral-500 mt-2">Given when a user passes the Captcha or links any wallet.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Pro Role ID (Optional)</label>
            <input
              type="text"
              name="pro_role_id"
              value={config.pro_role_id}
              onChange={handleChange}
              placeholder="e.g. 110294..."
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-text focus:outline-none focus:border-primary font-mono text-sm"
            />
            <p className="text-xs text-neutral-500 mt-2">Given ONLY to users with an active Daftar Premium subscription.</p>
          </div>
        </div>

        <hr className="border-border my-6" />

        {/* Channels */}
        <h3 className="text-xl font-semibold text-text mb-4">Channels & Categories</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Modlogs Channel ID</label>
            <input
              type="text"
              name="modlogs_channel_id"
              value={config.modlogs_channel_id}
              onChange={handleChange}
              placeholder="e.g. 110295..."
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-text focus:outline-none focus:border-primary font-mono text-sm"
            />
            <p className="text-xs text-neutral-500 mt-2">Where anti-spam warnings and /kick /ban logs are sent.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Support Category ID</label>
            <input
              type="text"
              name="support_category_id"
              value={config.support_category_id}
              onChange={handleChange}
              placeholder="e.g. 110296..."
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-text focus:outline-none focus:border-primary font-mono text-sm"
            />
            <p className="text-xs text-neutral-500 mt-2">The Category where new Support Tickets will be created.</p>
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-black font-semibold px-8 py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(var(--primary-rgb),0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
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
