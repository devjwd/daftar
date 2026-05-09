import React, { useState } from 'react';
import { CRITERIA_LABELS } from '../../config/badges';
import { fetchBadgeHolders } from '../../services/api';

export default function BadgeManager({ 
  badges, 
  handleEdit, 
  handleDelete, 
  handleRestore,
  handleToggle, 
  handleTogglePublic, 
  handleManageAllowlist,
  setSubTab,
  showDeleted,
  setShowDeleted
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [exporting, setExporting] = useState(false);

  const filteredBadges = badges.filter(b => (!!b.isDeleted || !!b.is_deleted) === showDeleted);

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
        winners.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
        <div className="ba-manage-title-group">
          <h3>{filteredBadges.length} Badge{filteredBadges.length !== 1 ? 's' : ''} {showDeleted ? 'in Trash' : 'Defined'}</h3>
          <div className="ba-filter-group">
            <button 
              className={`ba-filter-btn ${!showDeleted ? 'active' : ''}`}
              onClick={() => setShowDeleted(false)}
            >
              Active
            </button>
            <button 
              className={`ba-filter-btn ${showDeleted ? 'active' : ''}`}
              onClick={() => setShowDeleted(true)}
            >
              Trash
            </button>
          </div>
        </div>
        <button className="ba-btn ba-btn-primary" onClick={() => setSubTab('create')}>
          + New Badge
        </button>
      </div>

      {filteredBadges.length === 0 && (
        <div className="ba-empty-state">
          <h3>No {showDeleted ? 'deleted ' : ''}badges found.</h3>
          <p>{showDeleted ? 'Your trash is empty.' : "You haven't created any custom badges for the platform yet. Click the button above to get started!"}</p>
        </div>
      )}

      <div className="ba-badge-list">
        {filteredBadges.map(badge => (
          <div key={badge.id} className={`ba-badge-item ${!badge.enabled || badge.isDeleted || badge.is_deleted ? 'disabled' : ''}`}>
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
                {(badge.isDeleted || badge.is_deleted) && <span className="ba-criteria-tag" style={{ color: '#ef4444', borderColor: '#ef4444' }}>🗑️ Deleted</span>}
                {badge.metadata?.special?.isSpecial && <span className="ba-criteria-tag">✨ Special</span>}
              </div>
            </div>
            <div className="ba-badge-actions">
              {(badge.isDeleted || badge.is_deleted) ? (
                <>
                  <button className="ba-btn-icon" onClick={() => handleRestore(badge.id)} title="Restore">
                    🔄 Restore
                  </button>
                </>
              ) : (
                <>
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
                      <button className="ba-btn ba-btn-danger ba-btn-sm" onClick={() => handleDelete(badge.id)}>Trash</button>
                      <button className="ba-btn ba-btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="ba-btn-icon" onClick={() => setDeleteConfirm(badge.id)} title="Delete">🗑️</button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
