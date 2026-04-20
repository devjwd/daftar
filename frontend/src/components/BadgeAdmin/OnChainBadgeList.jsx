import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchBadges,
  pauseBadge,
  resumeBadge,
  discontinueBadge
} from '../../services/badgeService.js';
import { BADGE_STATUS, BADGE_STATUS_LABELS } from '../../config/badges.js';

export default function OnChainBadgeList({
  movementClient,
  account,
  connected,
  signAndSubmitTransaction,
  showMessage
}) {
  const [onChainBadges, setOnChainBadges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // badgeId

  const loadOnChain = useCallback(async () => {
    if (!movementClient) return;
    setLoading(true);
    try {
      const list = await fetchBadges(movementClient);
      setOnChainBadges(list || []);
    } catch (err) {
      console.error('[OnChainBadgeList] Load failed', err);
    } finally {
      setLoading(false);
    }
  }, [movementClient]);

  useEffect(() => {
    loadOnChain();
  }, [loadOnChain]);

  const handleAction = async (badgeId, actionFn, label) => {
    if (!connected || !account) return;
    setActionLoading(badgeId);
    try {
      await actionFn({ signAndSubmitTransaction, sender: account.address.toString(), badgeId });
      showMessage('success', `Badge ${label} successfully`);
      loadOnChain();
    } catch (err) {
      showMessage('error', err.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && onChainBadges.length === 0) return <div className="ba-loading">Loading on-chain state...</div>;

  return (
    <div className="ba-onchain-list">
      <div className="ba-onchain-header">
        <h3>On-Chain Badge Control</h3>
        <button className="ba-btn ba-btn-secondary" onClick={loadOnChain} disabled={loading}>🔄 Refresh</button>
      </div>

      <div className="ba-badge-list">
        {onChainBadges.length === 0 ? (
          <div className="ba-empty">No badges found on this contract.</div>
        ) : onChainBadges.map(badge => (
          <div key={badge.id} className="ba-badge-item">
            <div className="ba-badge-info">
              <h4>#{badge.id} {badge.name}</h4>
              <div className="ba-badge-meta">
                <span>Status: <strong>{BADGE_STATUS_LABELS[badge.status]}</strong></span>
                <span>Mints: {badge.totalMinted} / {badge.maxSupply > 0 ? badge.maxSupply : '∞'}</span>
              </div>
            </div>
            <div className="ba-badge-actions">
              {badge.status === BADGE_STATUS.ACTIVE && (
                <button
                  className="ba-btn ba-btn-warning"
                  onClick={() => handleAction(badge.id, pauseBadge, 'paused')}
                  disabled={actionLoading === badge.id}
                >
                  Pause
                </button>
              )}
              {badge.status === BADGE_STATUS.PAUSED && (
                <button
                  className="ba-btn ba-btn-success"
                  onClick={() => handleAction(badge.id, resumeBadge, 'resumed')}
                  disabled={actionLoading === badge.id}
                >
                  Resume
                </button>
              )}
              {badge.status !== BADGE_STATUS.DISCONTINUED && (
                <button
                  className="ba-btn ba-btn-danger"
                  onClick={() => handleAction(badge.id, discontinueBadge, 'discontinued')}
                  disabled={actionLoading === badge.id}
                >
                  Discontinue
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
