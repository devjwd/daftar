import React, { useMemo } from 'react';
import { 
  BADGE_CATEGORIES,
  CRITERIA_LABELS, 
  CRITERIA_PARAM_SCHEMAS,
  getRarityInfo
} from '../../config/badges.js';

const MINT_FEE_PRESETS = [
  { id: 'free', label: 'Free', value: '0' },
  { id: 'low', label: 'Low', value: '0.1' },
  { id: 'pro', label: 'Pro', value: '1' },
  { id: 'custom', label: 'Custom', value: '' }
];

export default function BadgeDefinitionForm({ 
  form, 
  setForm, 
  editingId, 
  submitting, 
  handleSubmit, 
  resetForm, 
  protocolOptions,
  criteriaOptions = []
}) {
  
  const updateForm = (key, value) => setForm(p => ({ ...p, [key]: value }));

  const handleMintFeePreset = (presetId) => {
    const preset = MINT_FEE_PRESETS.find(p => p.id === presetId);
    setForm(p => ({
      ...p,
      mintFeePreset: presetId,
      mintFeeMove: preset.value === '' ? p.mintFeeMove : preset.value
    }));
  };

  const updateSpecialSettings = (parent, key, value) => {
    setForm(p => ({
      ...p,
      metadata: {
        ...p.metadata,
        special: {
          ...p.metadata.special,
          [parent]: {
            ...p.metadata.special[parent],
            [key]: value
          }
        }
      }
    }));
  };

  const updateRewardSettings = (key, value) => {
    setForm(p => ({
      ...p,
      metadata: {
        ...p.metadata,
        special: {
          ...p.metadata.special,
          rewards: {
            ...p.metadata.special.rewards,
            [key]: value
          }
        }
      }
    }));
  };

  const toggleSpecialBadge = (enabled) => {
     setForm(p => ({
       ...p,
       metadata: {
         ...p.metadata,
         special: { ...p.metadata.special, isSpecial: enabled }
       }
     }));
  };

  const addCriterion = () => {
    setForm(p => ({
      ...p,
      criteria: [...p.criteria, { type: '', params: {} }]
    }));
  };

  const removeCriterion = (index) => {
    setForm(p => ({
      ...p,
      criteria: p.criteria.filter((_, i) => i !== index)
    }));
  };

  const updateCriterion = (index, key, value) => {
    setForm(p => {
      const next = [...p.criteria];
      if (key === 'type') {
        next[index] = { type: value, params: {} };
      } else {
        next[index] = { 
          ...next[index], 
          params: { ...next[index].params, [key]: value } 
        };
      }
      return { ...p, criteria: next };
    });
  };

  const rarityInfo = useMemo(() => getRarityInfo(form.rarity), [form.rarity]);

  const renderCriterionForm = (criterion, index) => {
    const schema = CRITERIA_PARAM_SCHEMAS[criterion.type] || {};
    return (
      <div key={index} className="ba-criterion-block">
        <div className="ba-criterion-header">
           <span className="ba-criterion-num">Criterion {index + 1}</span>
           {form.criteria.length > 1 && (
             <button type="button" className="ba-btn-remove" onClick={() => removeCriterion(index)}>&times;</button>
           )}
        </div>
        <div className="ba-field">
          <label>Criteria Type</label>
          <select value={criterion.type} onChange={e => updateCriterion(index, 'type', e.target.value)} className="ba-select">
            <option value="">Select criteria type...</option>
            {criteriaOptions.map(opt => <option key={opt.type} value={opt.type}>{opt.label || opt.name}</option>)}
          </select>
        </div>
        {criterion.type && Object.entries(schema).map(([pKey, pDef]) => (
          <div key={pKey} className="ba-field">
            <label>{pDef.label}</label>
            {pDef.type === 'textarea' && criterion.type === 'allowlist' ? (
              <div className="ba-allowlist-upload-zone">
                <div className="ba-allowlist-stats">
                  <strong>{criterion.params.addresses?.length || 0}</strong> wallets loaded
                </div>
                <div className="ba-allowlist-actions">
                  <label className="ba-file-btn">
                    <span>📁 Upload CSV/TXT</span>
                    <input 
                      type="file" 
                      accept=".csv,.txt" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const text = await file.text();
                        const found = text.match(/0x[a-fA-F0-9]{64}/g) || [];
                        const unique = [...new Set(found.map(a => a.toLowerCase()))];
                        updateCriterion(index, 'addresses', unique);
                      }}
                      style={{ display: 'none' }}
                    />
                  </label>
                  {criterion.params.addresses?.length > 0 && (
                    <button 
                      type="button" 
                      className="ba-btn-link" 
                      onClick={() => updateCriterion(index, 'addresses', [])}
                      style={{ marginLeft: '10px', color: '#ef4444' }}
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <small className="ba-hint">Automatically extracts 0x addresses from any file.</small>
              </div>
            ) : pDef.type === 'boolean' ? (
              <label className="ba-toggle-label">
                <input 
                  type="checkbox" 
                  checked={!!(criterion.params[pKey] ?? pDef.default)} 
                  onChange={e => updateCriterion(index, pKey, e.target.checked)}
                />
                <span>Enable {pDef.label}</span>
              </label>
            ) : pDef.type === 'select' ? (
              <select 
                value={criterion.params[pKey] || ''} 
                onChange={e => updateCriterion(index, pKey, e.target.value)}
                className="ba-select"
              >
                <option value="">Select...</option>
                {(pKey === 'protocolKey' ? protocolOptions : pDef.options || []).map(o => (
                  <option key={o.value || o} value={o.value || o}>{o.label || o}</option>
                ))}
              </select>
            ) : (
              <input 
                type={pDef.type === 'number' ? 'number' : 'text'}
                value={criterion.params[pKey] ?? pDef.default ?? ''}
                onChange={e => updateCriterion(index, pKey, pDef.type === 'number' ? Number(e.target.value) : e.target.value)}
                className="ba-input"
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <form className="ba-form" onSubmit={handleSubmit}>
      <div className="ba-form-grid">
        <div className="ba-form-left">
          <h3>Create New Badge</h3>
          <div className="ba-field">
            <label>Badge Name <span className="ba-required">*</span></label>
            <input 
              type="text" 
              placeholder="e.g. Power Trader"
              value={form.name} 
              onChange={e => updateForm('name', e.target.value)} 
              className="ba-input" 
              required 
            />
          </div>
          <div className="ba-field">
            <label>Description</label>
            <textarea 
              placeholder="What this badge represents..."
              value={form.description} 
              onChange={e => updateForm('description', e.target.value)} 
              className="ba-textarea" 
              rows={3} 
            />
          </div>
          <div className="ba-field">
            <label>Image URL <span className="ba-required">*</span></label>
            <input 
              type="url" 
              placeholder="https://example.com/badge.png"
              value={form.imageUrl} 
              onChange={e => updateForm('imageUrl', e.target.value)} 
              className="ba-input" 
              required 
            />
          </div>

          <div className="ba-field-row">
             <div className="ba-field">
               <label>XP Reward</label>
               <input type="number" value={form.xp} onChange={e => updateForm('xp', Number(e.target.value))} className="ba-input" />
             </div>
             <div className="ba-field" style={{ gridColumn: 'span 2' }}>
               <label>Mint Fee Preset</label>
               <div className="ba-chip-row" style={{ marginTop: '8px' }}>
                 {MINT_FEE_PRESETS.map(p => (
                   <button 
                     key={p.id} type="button" 
                     className={`ba-chip ${form.mintFeePreset === p.id ? 'active' : ''}`}
                     onClick={() => handleMintFeePreset(p.id)}
                   >
                     {p.label}
                   </button>
                 ))}
               </div>
             </div>
          </div>

          {form.mintFeePreset === 'custom' && (
            <div className="ba-field">
              <label>Mint Fee (MOVE)</label>
              <input 
                type="number" step="0.01" 
                value={form.mintFeeMove} 
                onChange={e => updateForm('mintFeeMove', e.target.value)} 
                className="ba-input" 
              />
              <p className="ba-hint">0 = free. 1 MOVE = 100,000,000 octas on-chain.</p>
            </div>
          )}

          <div className="ba-special-inline">
             <label className="ba-toggle-label">
                <input type="checkbox" checked={!!form.metadata?.special?.isSpecial} onChange={e => toggleSpecialBadge(e.target.checked)} />
                <span>Mark as Special Badge</span>
             </label>
             {form.metadata?.special?.isSpecial && (
               <div className="ba-special-panel">
                  <label className="ba-toggle-label">
                    <input type="checkbox" checked={!!form.metadata?.special?.timeLimited?.enabled} onChange={e => updateSpecialSettings('timeLimited', 'enabled', e.target.checked)} />
                    <span>Time Limited</span>
                  </label>
                  {form.metadata?.special?.timeLimited?.enabled && (
                    <div className="ba-field-row" style={{ marginTop: '10px' }}>
                      <input type="datetime-local" value={form.metadata?.special?.timeLimited?.startsAt} onChange={e => updateSpecialSettings('timeLimited', 'startsAt', e.target.value)} className="ba-input" />
                      <input type="datetime-local" value={form.metadata?.special?.timeLimited?.endsAt} onChange={e => updateSpecialSettings('timeLimited', 'endsAt', e.target.value)} className="ba-input" />
                    </div>
                  )}
               </div>
             )}
          </div>

          {form.metadata?.special?.isSpecial && (
            <div className="ba-reward-hub" style={{ marginTop: '16px' }}>
              <div className="ba-reward-header">
                <label className="ba-toggle-label">
                  <input type="checkbox" checked={!!form.metadata?.special?.rewards?.enabled} onChange={e => updateRewardSettings('enabled', e.target.checked)} />
                  <span>Link Token Reward to Badge</span>
                </label>
              </div>
              {form.metadata?.special?.rewards?.enabled && (
                <div className="ba-reward-body" style={{ marginTop: '12px' }}>
                  <div className="ba-field-row">
                    <div className="ba-field">
                      <label>Amount</label>
                      <input type="number" value={form.metadata?.special?.rewards?.tokenAmount} onChange={e => updateRewardSettings('tokenAmount', e.target.value)} className="ba-input" placeholder="0" />
                    </div>
                    <div className="ba-field">
                      <label>Symbol</label>
                      <input type="text" value={form.metadata?.special?.rewards?.tokenSymbol} onChange={e => updateRewardSettings('tokenSymbol', e.target.value)} className="ba-input" placeholder="MOVE" />
                    </div>
                  </div>
                  <div className="ba-field">
                    <label>Distribution Strategy</label>
                    <select value={form.metadata?.special?.rewards?.strategy} onChange={e => updateRewardSettings('strategy', e.target.value)} className="ba-select">
                      <option value="first_come">First Come, First Served (FCFS)</option>
                      <option value="random">Random Draw (Lucky Holders)</option>
                    </select>
                  </div>
                  <div className="ba-field">
                    <label>Participant Limit (Max winners)</label>
                    <input type="number" value={form.metadata?.special?.rewards?.limit} onChange={e => updateRewardSettings('limit', Number(e.target.value))} className="ba-input" />
                    <p className="ba-hint">e.g., Reward the first 100 holders or pick 100 random winners.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="ba-field">
            <label>External URL (Optional)</label>
            <input 
              type="url" 
              placeholder="https://..."
              value={form.metadata?.externalUrl} 
              onChange={e => setForm(p => ({ ...p, metadata: { ...p.metadata, externalUrl: e.target.value } }))} 
              className="ba-input" 
            />
          </div>

          <div className="ba-field-toggle">
            <label className="ba-toggle-label">
              <input type="checkbox" checked={form.isPublic} onChange={e => updateForm('isPublic', e.target.checked)} />
              <span>Public badge (visible to everyone)</span>
            </label>
          </div>
          <div className="ba-field-toggle">
            <label className="ba-toggle-label">
              <input type="checkbox" checked={form.enabled} onChange={e => updateForm('enabled', e.target.checked)} />
              <span>Enabled (active in eligibility/mint flow)</span>
            </label>
          </div>
        </div>

        <div className="ba-form-right">
          <h3>Eligibility Criteria</h3>
          <p className="ba-hint">Mintable badges currently support exactly one on-chain criterion.</p>
          {form.criteria.map((c, i) => renderCriterionForm(c, i))}
          <button type="button" className="ba-btn ba-btn-secondary ba-btn-add-criterion" onClick={addCriterion}>+ Add Another Criterion</button>

          <div className="ba-live-preview-section" style={{ marginTop: '40px' }}>
             <div className="ba-live-preview-head">
               <span>Live Preview</span>
             </div>
             <div className="ba-live-card">
                <div className="ba-live-card-media">
                   {form.imageUrl ? (
                     <img src={form.imageUrl} alt="Preview" className="ba-live-card-image" />
                   ) : (
                     <span className="ba-live-card-fallback">🏅</span>
                   )}
                   <div className="ba-live-rarity-pill" style={{ background: rarityInfo.color }}>
                      {form.rarity}
                   </div>
                   <div className="ba-live-xp-pill">
                      +{form.xp} XP
                   </div>
                </div>
                <div className="ba-live-card-content">
                   <h4>{form.name || 'Badge Name Preview'}</h4>
                   <p>{form.description || 'Badge description preview will appear here as you type.'}</p>
                   <div className="ba-live-chip-row">
                      <div className="ba-live-chip">Fee: {form.mintFeeMove === '0' ? 'Free' : `${form.mintFeeMove} MOVE`}</div>
                      {form.criteria.map((c, i) => c.type && (
                        <div key={i} className="ba-live-chip ba-live-chip-criteria">
                          {CRITERIA_LABELS[c.type] || c.type}
                        </div>
                      ))}
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>

      <div className="ba-form-actions">
        <button type="submit" className="ba-btn ba-btn-primary ba-btn-large" disabled={submitting}>
          {submitting ? 'Processing...' : (editingId ? 'Update Badge' : 'Create Badge')}
        </button>
        <button type="button" className="ba-btn ba-btn-secondary ba-btn-large" onClick={resetForm}>Reset</button>
      </div>
    </form>
  );
}
