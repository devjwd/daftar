import React, { useState } from 'react';
import { CRITERIA_LABELS } from '../../config/badges.js';
import { fetchBadgeHolders } from '../../services/badgeApi.js';

export default function BadgeManager({ 
  badges, 
  handleEdit, 
  handleDelete, 
  handleToggle, 
  handleTogglePublic, 
  handleManageAllowlist,
  setSubTab 
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [exporting, setExporting] = useState(false);

  const hasAllowlist = (badge) => badge.criteria.some(c => c.type === 'allowlist');
  const hasRewards = (badge) => badge.metadata?.special?.rewards?.enabled;

  const handleExportWinners = async (badge) => {
    if (exporting) return;
    const config = badge.metadata?.special?.rewards || {};
    const strategy = config.strategy || 'first_come';
    const limit = Number(config.limit) || 100;
    
    setExporting(true);
    try {
      const { ok, data, error } = await fetchBadgeHolders(badge.id);
      if (!ok) throw new Error(error || 'Failed to fetch holders');
      if (!data.length) {
        alert('No holders found for this badge yet.');
        return;
      }

      let winners = [...data];

      // Selection Logic
      if (strategy === 'first_come') {
        // Sort by mint time (oldest first)
        winners.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      } else if (strategy === 'random') {
        // Fisher-Yates Shuffle
        for (let i = winners.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [winners[i], winners[j]] = [winners[j], winners[i]];
        }
      }

      // Apply Limit
      winners = winners.slice(0, limit);

      // Generate CSV
      const csvContent = "address,minted_at\n" + 
        winners.map(w => `${w.wallet_address},${w.created_at}`).join("\n");
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `winners_${badge.name.replace(/\s+/g, '_').toLowerCase()}_${strategy}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } catch (err) {
      console.error('[BadgeManager] Export failed', err);
      alert('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="ba-manage">
      <div className="ba-manage-header">
        <h3>{badges.length} Badge{badges.length !== 1 ? 's' : ''} Defined</h3>
        <button className="ba-btn ba-btn-primary" onClick={() => setSubTab('create')}>
          + New Badge
        </button>
      </div>

      <div className="ba-badge-list">
        {badges.map(badge => (
          <div key={badge.id} className={`ba-badge-item ${!badge.enabled ? 'disabled' : ''}`}>
            <div className="ba-badge-preview">
              {badge.imageUrl ? (
                <img src={badge.imageUrl} alt={badge.name} className="ba-badge-thumb" />
              ) : (
                <div className="ba-badge-placeholder">🏅</div>
              )}
            </div>
            <div className="ba-badge-info">
              <div className="ba-badge-title-row">
                <h4>{badge.name}</h4>
                <span className="ba-xp-pill">+{badge.xp} XP</span>
              </div>
              <p className="ba-badge-desc">{badge.description}</p>
              <div className="ba-badge-criteria-tags">
                {badge.criteria.map((c, i) => (
                  <span key={i} className="ba-criteria-tag">
                    {CRITERIA_LABELS[c.type] || c.type}
                  </span>
                ))}
                <span className="ba-criteria-tag">{badge.isPublic === false ? 'Private' : 'Public'}</span>
                {badge.metadata?.special?.isSpecial && <span className="ba-criteria-tag">✨ Special</span>}
                {hasRewards(badge) && <span className="ba-criteria-tag" style={{ color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.4)' }}>🎁 Reward</span>}
              </div>
            </div>
            <div className="ba-badge-actions">
              {hasRewards(badge) && (
                <button 
                  className="ba-btn-icon" 
                  onClick={() => handleExportWinners(badge)} 
                  title="Export Winners"
                  disabled={exporting}
                  style={{ color: '#f59e0b' }}
                >
                  {exporting ? '...' : '🏆'}
                </button>
              )}
              <button className="ba-btn-icon" onClick={() => handleTogglePublic(badge.id)} title="Visibility">
                {badge.isPublic === false ? '🔒' : '🌍'}
              </button>
              <button className="ba-btn-icon" onClick={() => handleToggle(badge.id)} title="Enable/Disable">
                {badge.enabled ? '🟢' : '🔴'}
              </button>
              {hasAllowlist(badge) && (
                <button className="ba-btn-icon" onClick={() => handleManageAllowlist(badge)} title="Manage Allowlist">📋</button>
              )}
              <button className="ba-btn-icon" onClick={() => handleEdit(badge)} title="Edit">✏️</button>
              {deleteConfirm === badge.id ? (
                <div className="ba-delete-confirm">
                  <button className="ba-btn ba-btn-danger ba-btn-sm" onClick={() => handleDelete(badge.id)}>Confirm</button>
                  <button className="ba-btn ba-btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                </div>
              ) : (
                <button className="ba-btn-icon" onClick={() => setDeleteConfirm(badge.id)} title="Delete">🗑️</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
