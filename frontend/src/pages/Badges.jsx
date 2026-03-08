/**
 * Badges Page
 * 
 * Displays all SBT badges categorized by state:
 * - Eligible to Claim (with mint action)
 * - Earned Badges  
 * - Locked (in progress)
 * 
 * Features real-time eligibility polling and category filtering.
 */
import './Badges.css';
import { useState, useMemo, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { DEFAULT_NETWORK } from '../config/network.js';
import { BADGE_CATEGORIES } from '../config/badges.js';
import { awardBadge } from '../services/badges/badgeStore.js';
import { mintBadge, mintBadgeWithBalance } from '../services/badgeService.js';
import useBadges from '../hooks/useBadges.js';
import BadgeCard from '../components/BadgeCard.jsx';

export default function Badges() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [activeCategory, setActiveCategory] = useState('all');
  const [mintingIds, setMintingIds] = useState(new Set());
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const movementClient = useMemo(
    () => new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: DEFAULT_NETWORK.rpc })),
    []
  );

  const address = connected && account?.address
    ? (typeof account.address === 'string' ? account.address : account.address.toString())
    : null;

  const {
    badges,
    totalBadges,
    earnedCount,
    eligibleCount,
    completionPercent,
    loading,
    refresh,
  } = useBadges(address, {
    client: movementClient,
    enablePolling: true,
  });

  const earnedLabel = `${earnedCount} of ${totalBadges} Earned`;

  // Category filter
  const categoryList = useMemo(() => {
    const cats = [{ id: 'all', name: 'All', icon: '🏅' }];
    Object.values(BADGE_CATEGORIES).forEach(cat => {
      const count = badges.filter(b => b.category === cat.id).length;
      if (count > 0) cats.push({ ...cat, count });
    });
    return cats;
  }, [badges]);

  const filteredBadges = useMemo(() => {
    if (activeCategory === 'all') return badges;
    return badges.filter(b => b.category === activeCategory);
  }, [badges, activeCategory]);

  const filteredEarned = useMemo(() => filteredBadges.filter(b => b.earned), [filteredBadges]);
  const filteredEligible = useMemo(() => filteredBadges.filter(b => b.eligible && !b.earned), [filteredBadges]);
  const filteredLocked = useMemo(() => filteredBadges.filter(b => b.locked), [filteredBadges]);

  // Mint handler
  const handleMint = useCallback(async (badge) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      setError('Please connect your wallet to claim badges');
      return;
    }

    setError('');
    setSuccessMsg('');
    setMintingIds(prev => new Set([...prev, badge.id]));

    try {
      // If badge has on-chain ID, do on-chain mint
      if (badge.onChainBadgeId != null) {
        const senderAddress = typeof account.address === 'string' ? account.address : account.address.toString();
        if (badge.criteria?.some(c => c.type === 'min_balance')) {
          const balanceCriteria = badge.criteria.find(c => c.type === 'min_balance');
          await mintBadgeWithBalance({
            signAndSubmitTransaction,
            sender: senderAddress,
            badgeId: badge.onChainBadgeId,
            coinType: balanceCriteria.params.coinType,
          });
        } else {
          await mintBadge({
            signAndSubmitTransaction,
            sender: senderAddress,
            badgeId: badge.onChainBadgeId,
          });
        }
      }

      // Record the award locally
      awardBadge(address, badge.id, {
        txHash: null,
        metadata: { mintedAt: Date.now() },
      });

      setSuccessMsg(`"${badge.name}" badge claimed!`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error('Mint error:', err);
      setError(err.message || 'Failed to claim badge. Please try again.');
    } finally {
      setMintingIds(prev => {
        const next = new Set(prev);
        next.delete(badge.id);
        return next;
      });
    }
  }, [connected, account, signAndSubmitTransaction, address]);

  return (
    <div className="badges-page">
      <div className="badges-container">
        <header className="badges-header">
          <div className="badges-header-text">
            <span className="badges-eyebrow">Achievements</span>
            <h1>Badges</h1>
            <p>Earn SBT achievements by participating in the Movement Network.</p>
          </div>

          <div className="badges-progress" aria-label="Badge progress summary">
            <span className="progress-text">{earnedLabel}</span>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${completionPercent}%` }} />
            </div>
          </div>
        </header>

        {/* Messages */}
        {successMsg && <div className="badges-msg badges-msg-success">{successMsg}</div>}
        {error && <div className="badges-msg badges-msg-error">{error}</div>}

        {/* Category Filters */}
        {categoryList.length > 2 && (
          <div className="badges-categories">
            {categoryList.map(cat => (
              <button
                key={cat.id}
                className={`badges-cat-btn ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.icon} {cat.name}
                {cat.count != null && <span className="badges-cat-count">{cat.count}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Not connected */}
        {!connected && (
          <div className="badges-connect-prompt">
            <div className="badges-connect-icon">🔐</div>
            <p>Connect your wallet to view your badge progress and claim earned badges.</p>
          </div>
        )}

        {/* Loading */}
        {connected && loading && totalBadges > 0 && filteredBadges.length === 0 && (
          <div className="badges-loading">
            <div className="badges-spinner" />
            <p>Checking eligibility...</p>
          </div>
        )}

        {/* No badges defined yet */}
        {connected && !loading && totalBadges === 0 && (
          <div className="badges-empty">
            <p>No badges available yet</p>
          </div>
        )}

        {/* Badge Sections */}
        {connected && filteredBadges.length > 0 && (
          <>
            {/* Real-time indicator */}
            {loading && (
              <div className="badges-realtime-indicator">
                <span className="badges-pulse-dot" />
                Updating eligibility...
              </div>
            )}

            {/* Refresh button */}
            <div className="badges-toolbar">
              <button className="badges-refresh-btn" onClick={refresh} disabled={loading}>
                ↻ Refresh
              </button>
            </div>

            {/* Eligible */}
            {filteredEligible.length > 0 && (
              <section className="badges-section">
                <h2 className="badges-section-title">
                  <span className="badges-section-icon">🎁</span>
                  Ready to Claim
                  <span className="badges-section-count">{filteredEligible.length}</span>
                </h2>
                <div className="badges-grid">
                  {filteredEligible.map(badge => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      eligible
                      progress={badge.progress}
                      criteriaResults={badge.criteriaResults}
                      onMint={handleMint}
                      minting={mintingIds.has(badge.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Earned */}
            {filteredEarned.length > 0 && (
              <section className="badges-section">
                <h2 className="badges-section-title">
                  <span className="badges-section-icon">✅</span>
                  Your Badges
                  <span className="badges-section-count">{filteredEarned.length}</span>
                </h2>
                <div className="badges-grid">
                  {filteredEarned.map(badge => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      earned
                      earnedDate={badge.earnedDate}
                      progress={100}
                      criteriaResults={badge.criteriaResults}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Locked */}
            {filteredLocked.length > 0 && (
              <section className="badges-section">
                <h2 className="badges-section-title">
                  <span className="badges-section-icon">🔒</span>
                  In Progress
                  <span className="badges-section-count">{filteredLocked.length}</span>
                </h2>
                <div className="badges-grid">
                  {filteredLocked.map(badge => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      progress={badge.progress}
                      criteriaResults={badge.criteriaResults}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
