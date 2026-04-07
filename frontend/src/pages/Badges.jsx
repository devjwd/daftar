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
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { DEFAULT_NETWORK } from '../config/network.js';
import { awardBadge } from '../services/badges/badgeStore.js';
import { mintBadge, mintBadgeWithBalance } from '../services/badgeService.js';
import { confirmMintAndOwnership } from '../services/badges/mintVerification.js';
import useBadges from '../hooks/useBadges.js';
import useBadgeEligibility from '../hooks/useBadgeEligibility.js';

const getProgressMessage = (progress, fallbackReason) => {
  const current = Number(progress?.current);
  const required = Number(progress?.required);

  if (Number.isFinite(current) && Number.isFinite(required) && required > 0) {
    const ratio = current / required;
    const suffix = ratio >= 0.9 ? 'almost there!' : 'keep going';
    return `${Math.floor(current)}/${Math.floor(required)} — ${suffix}`;
  }

  return fallbackReason || 'Not eligible yet';
};

const isMinBalanceRule = (badge) => {
  const directRule = String(badge?.rule_type || badge?.ruleType || '').trim().toUpperCase();
  if (directRule === 'MIN_BALANCE') return true;

  const criteria = Array.isArray(badge?.criteria) ? badge.criteria : [];
  return criteria.some((criterion) => String(criterion?.type || '').toLowerCase() === 'min_balance');
};

function BadgeEligibilityActions({ badge, minting, onMint, disabled }) {
  const { status, progress, reason, checkEligibility, isLoading } = useBadgeEligibility(badge.id);
  const effectiveStatus = badge.earned ? 'already_owned' : status;

  if (effectiveStatus === 'loading' || isLoading) {
    return (
      <div className="achievement-inline-status" role="status" aria-live="polite">
        <span className="achievement-inline-spinner" />
        <span>Checking your wallet...</span>
      </div>
    );
  }

  if (effectiveStatus === 'eligible') {
    return (
      <div className="achievement-claim-wrap">
        <span className="achievement-ok">✓ Eligible</span>
        <button
          className="achievement-claim-btn"
          onClick={(event) => {
            event.stopPropagation();
            onMint(badge);
          }}
          disabled={minting || disabled}
        >
          {minting ? 'Claiming...' : 'Claim Badge'}
        </button>
      </div>
    );
  }

  if (effectiveStatus === 'not_eligible') {
    const progressMessage = getProgressMessage(progress, reason);
    const width = Number(progress?.required) > 0
      ? Math.max(4, Math.min(100, (Number(progress?.current || 0) / Number(progress.required)) * 100))
      : 8;

    return (
      <div className="achievement-not-eligible-wrap">
        <p className="achievement-progress-text">{progressMessage}</p>
        <div className="achievement-progress" aria-label={progressMessage}>
          <div className="achievement-progress-fill" style={{ width: `${width}%` }} />
        </div>
        <button
          className="achievement-check-btn"
          onClick={(event) => {
            event.stopPropagation();
            checkEligibility({ force: true });
          }}
          type="button"
        >
          Re-check
        </button>
      </div>
    );
  }

  if (effectiveStatus === 'already_owned') {
    return (
      <button className="achievement-check-btn" disabled type="button">
        You own this badge ✓
      </button>
    );
  }

  if (effectiveStatus === 'requires_admin') {
    return <p className="achievement-muted-note">Contact admin to enable claiming</p>;
  }

  if (effectiveStatus === 'error') {
    return (
      <div className="achievement-not-eligible-wrap">
        <p className="achievement-muted-note">Check failed — try again</p>
        {reason ? <p className="achievement-muted-note achievement-muted-note-small">{reason}</p> : null}
        <button
          className="achievement-check-btn"
          onClick={(event) => {
            event.stopPropagation();
            checkEligibility({ force: true });
          }}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <button
      className="achievement-check-btn"
      onClick={(event) => {
        event.stopPropagation();
        checkEligibility();
      }}
      type="button"
    >
      Check Eligibility
    </button>
  );
}

export default function Badges() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [lifecycleTab, setLifecycleTab] = useState('active');
  const [mintingIds, setMintingIds] = useState(new Set());
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [claimedAnimIds, setClaimedAnimIds] = useState(new Set());

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
    completionPercent,
    loading,
    refresh,
  } = useBadges(address, {
    client: movementClient,
    enablePolling: false,
  });

  const earnedLabel = `${earnedCount} of ${totalBadges} Earned`;

  const isBadgeExpired = useCallback((badge) => {
    const timeLimited = badge?.metadata?.special?.timeLimited;
    if (!timeLimited?.enabled || !timeLimited?.endsAt) return false;
    const endsAtMs = Date.parse(timeLimited.endsAt);
    return Number.isFinite(endsAtMs) && endsAtMs < Date.now();
  }, []);

  const badgesWithLifecycle = useMemo(
    () => badges.map((badge) => ({ ...badge, isExpired: isBadgeExpired(badge) })),
    [badges, isBadgeExpired]
  );

  const activeBadges = useMemo(
    () => badgesWithLifecycle.filter((badge) => !badge.isExpired),
    [badgesWithLifecycle]
  );

  const expiredBadges = useMemo(
    () => badgesWithLifecycle.filter((badge) => badge.isExpired),
    [badgesWithLifecycle]
  );

  const visibleBadges = lifecycleTab === 'expired' ? expiredBadges : activeBadges;

  const completedBadges = useMemo(
    () => visibleBadges.filter((badge) => badge.earned || badge.eligible),
    [visibleBadges]
  );

  const incompleteBadges = useMemo(
    () => visibleBadges.filter((badge) => !badge.earned && !badge.eligible),
    [visibleBadges]
  );

  const closeBadgeModal = useCallback(() => {
    setSelectedBadge(null);
  }, []);

  const syncBadgeMint = useCallback(async ({ senderAddress, badge, txHash, attempt = 0 }) => {
    const response = await fetch('/api/badges/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: senderAddress,
        badgeId: badge.id,
        onChainBadgeId: badge.onChainBadgeId,
        txHash,
        xpValue: Number(badge.xp || 0),
        badgeName: badge.name,
        rarity: badge.rarity,
      }),
    });

    if (response.ok) {
      return true;
    }

    if (attempt === 0) {
      setSuccessMsg('Badge minted successfully but XP sync failed. Your XP will update shortly.');
      setTimeout(() => setSuccessMsg(''), 6500);
      setTimeout(() => {
        void syncBadgeMint({ senderAddress, badge, txHash, attempt: 1 });
      }, 5000);
    }

    const payload = await response.json().catch(() => null);
    console.warn('[badges] sync endpoint returned non-OK status', response.status, payload);
    return false;
  }, []);

  useEffect(() => {
    if (!selectedBadge) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeBadgeModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedBadge, closeBadgeModal]);

  const handleShareBadge = useCallback(async (badge) => {
    const shareTitle = `${badge.name} achievement`;
    const shareText = `${badge.name} - ${badge.description || 'Movement Network achievement unlocked.'}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${shareTitle}\n${shareText}`);
        setSuccessMsg('Achievement details copied to clipboard.');
        setTimeout(() => setSuccessMsg(''), 2500);
      } else {
        setError('Sharing is not supported on this browser.');
        setTimeout(() => setError(''), 2500);
      }
    } catch (err) {
      // Ignore abort errors from dismissed native share sheet.
      if (err?.name !== 'AbortError') {
        setError('Could not share this achievement right now.');
        setTimeout(() => setError(''), 2500);
      }
    }
  }, []);

  const renderAchievementCard = (badge) => {
    const badgeState = badge.earned ? 'earned' : (badge.eligible || badge.attestationPending || badge.attestationFailed) ? 'ready' : 'locked';
    const progressClamped = Math.max(0, Math.min(100, badge.progress || 0));
    const isMinting = mintingIds.has(badge.id);
    const successPulse = claimedAnimIds.has(badge.id);

    return (
      <article
        key={badge.id}
        className={`achievement-card achievement-${badgeState} ${badge.isExpired ? 'achievement-expired' : ''} ${successPulse ? 'achievement-success-pop' : ''}`}
        onClick={() => setSelectedBadge(badge)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelectedBadge(badge);
          }
        }}
      >
        <div className="achievement-icon-wrap" aria-hidden="true">
          {badge.imageUrl ? (
            <img src={badge.imageUrl} alt="" className="achievement-icon-image" loading="lazy" />
          ) : (
            <span className="achievement-icon-fallback">{badge.emoji || '🏅'}</span>
          )}
        </div>

        <div className="achievement-content">
          <h3>{badge.name}</h3>
          <p>{badge.description || 'Complete this challenge to unlock the achievement.'}</p>

          {!badge.earned && !badge.eligible && progressClamped > 0 && (
            <div className="achievement-progress" aria-label={`Progress ${Math.round(progressClamped)} percent`}>
              <div className="achievement-progress-fill" style={{ width: `${progressClamped}%` }} />
            </div>
          )}
        </div>

        <div className="achievement-actions">
          <BadgeEligibilityActions
            badge={badge}
            minting={isMinting}
            onMint={handleMint}
            disabled={badge.isExpired}
          />

          {badge.earned && <span className="achievement-status-pill">Unlocked</span>}
          {!badge.earned && !badge.eligible && !badge.attestationPending && !badge.attestationFailed && <span className="achievement-status-pill">Locked</span>}
          {badge.publishPending && <span className="achievement-status-pill">Publishing on-chain</span>}
          {badge.attestationPending && <span className="achievement-status-pill">Attesting…</span>}
          {badge.attestationFailed && <span className="achievement-status-pill achievement-status-pill--warn" title="Auto-attestation failed. The on-chain service may not be configured yet.">Attestation unavailable</span>}

          <span className="achievement-chevron" aria-hidden="true">›</span>
        </div>
      </article>
    );
  };

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
      if (badge.onChainBadgeId == null) {
        throw new Error('Badge is not yet published on-chain. Please wait for admin to publish this SBT.');
      }

      let txHash = null;
      const senderAddress = typeof account.address === 'string' ? account.address : account.address.toString();
      if (isMinBalanceRule(badge)) {
        const criteria = Array.isArray(badge.criteria) ? badge.criteria : [];
        const balanceCriteria = criteria.find((c) => String(c?.type || '').toLowerCase() === 'min_balance');
        const coinType =
          String(badge?.rule_params?.coinType || '').trim() ||
          String(balanceCriteria?.params?.coinType || '').trim();

        if (!coinType) {
          throw new Error('MIN_BALANCE badge requires coinType in rule params.');
        }

        const tx = await mintBadgeWithBalance({
          signAndSubmitTransaction,
          sender: senderAddress,
          badgeId: badge.onChainBadgeId,
          coinType,
          badge,
        });
        txHash = await confirmMintAndOwnership({
          client: movementClient,
          txResponse: tx,
          badgeId: badge.onChainBadgeId,
          owner: senderAddress,
        });
      } else {
        const tx = await mintBadge({
          signAndSubmitTransaction,
          sender: senderAddress,
          badgeId: badge.onChainBadgeId,
          badge,
        });
        txHash = await confirmMintAndOwnership({
          client: movementClient,
          txResponse: tx,
          badgeId: badge.onChainBadgeId,
          owner: senderAddress,
        });
      }

      let syncOk = true;
      try {
        syncOk = await syncBadgeMint({ senderAddress, badge, txHash });
      } catch (syncError) {
        syncOk = false;
        setSuccessMsg('Badge minted successfully but XP sync failed. Your XP will update shortly.');
        setTimeout(() => setSuccessMsg(''), 6500);
        setTimeout(() => {
          void syncBadgeMint({ senderAddress, badge, txHash, attempt: 1 });
        }, 5000);
        console.warn('[badges] sync endpoint call failed', syncError);
      }

      await awardBadge(address, badge.id, {
        txHash,
        onChainBadgeId: badge.onChainBadgeId,
        metadata: { mintedAt: Date.now() },
      });

      setClaimedAnimIds((prev) => new Set([...prev, badge.id]));
      setTimeout(() => {
        setClaimedAnimIds((prev) => {
          const next = new Set(prev);
          next.delete(badge.id);
          return next;
        });
      }, 1400);

      if (syncOk) {
        setSuccessMsg(`"${badge.name}" badge claimed!`);
        setTimeout(() => setSuccessMsg(''), 4000);
      }
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
  }, [connected, account, signAndSubmitTransaction, address, movementClient, syncBadgeMint]);

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

        {/* Not connected */}
        {!connected && (
          <div className="badges-connect-prompt">
            <div className="badges-connect-icon">🔐</div>
            <p>Connect your wallet to view your badge progress and claim earned badges.</p>
          </div>
        )}

        {/* Loading */}
        {connected && loading && totalBadges > 0 && badgesWithLifecycle.length === 0 && (
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
        {connected && badgesWithLifecycle.length > 0 && (
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

            <div className="achievement-tabs" role="tablist" aria-label="Badge lifecycle filters">
              <button
                className={`achievement-tab ${lifecycleTab === 'active' ? 'is-active' : ''}`}
                onClick={() => setLifecycleTab('active')}
                role="tab"
                aria-selected={lifecycleTab === 'active'}
              >
                Active
                <span>{activeBadges.length}</span>
              </button>
              <button
                className={`achievement-tab ${lifecycleTab === 'expired' ? 'is-active' : ''}`}
                onClick={() => setLifecycleTab('expired')}
                role="tab"
                aria-selected={lifecycleTab === 'expired'}
              >
                Expired
                <span>{expiredBadges.length}</span>
              </button>
            </div>

            {visibleBadges.length === 0 && (
              <div className="badges-empty">
                <p>{lifecycleTab === 'expired' ? 'No expired badges yet.' : 'No active badges yet.'}</p>
              </div>
            )}

            {visibleBadges.length > 0 && (
              <>
                <section className="badges-section">
                  <h2 className="badges-section-title">
                    Completed
                    <span className="badges-section-count">{completedBadges.length}</span>
                    <small>Achievements are updated weekly.</small>
                  </h2>
                  <div className="achievement-grid">
                    {completedBadges.map(renderAchievementCard)}
                  </div>
                </section>

                <section className="badges-section">
                  <h2 className="badges-section-title">
                    Incomplete
                    <span className="badges-section-count">{incompleteBadges.length}</span>
                    <small>Keep trading to unlock more.</small>
                  </h2>
                  <div className="achievement-grid">
                    {incompleteBadges.map(renderAchievementCard)}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>

      {selectedBadge && (
        <div className="badge-modal-backdrop" onClick={closeBadgeModal} role="presentation">
          <div
            className="badge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="badge-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="badge-modal-close" onClick={closeBadgeModal} aria-label="Close badge details">
              ×
            </button>

            <div className="badge-modal-icon-wrap" aria-hidden="true">
              {selectedBadge.imageUrl ? (
                <img src={selectedBadge.imageUrl} alt="" className="badge-modal-icon-image" loading="lazy" />
              ) : (
                <span className="badge-modal-icon-fallback">{selectedBadge.emoji || '🏅'}</span>
              )}
            </div>

            <h3 id="badge-modal-title">{selectedBadge.name}</h3>
            <p>{selectedBadge.description || 'Complete this challenge to unlock this achievement.'}</p>

            <div className="badge-modal-meta">
              {selectedBadge.earned && <span className="badge-modal-pill is-earned">Unlocked</span>}
              {selectedBadge.eligible && !selectedBadge.earned && <span className="badge-modal-pill is-claim">Ready to claim</span>}
              {!selectedBadge.earned && !selectedBadge.eligible && <span className="badge-modal-pill is-locked">In progress</span>}
            </div>

            {selectedBadge.attestationPending && (
              <p className="badge-modal-note">
                You&apos;re eligible! On-chain attestation is being processed automatically — the Claim button will appear shortly.
              </p>
            )}
            {selectedBadge.attestationFailed && (
              <p className="badge-modal-note badge-modal-note--warn">
                You&apos;re eligible, but the on-chain attestation service isn&apos;t available right now (the badge may not be configured on-chain yet). Contact the admin to enable claiming.
              </p>
            )}

            <button
              className="badge-modal-share"
              onClick={() => handleShareBadge(selectedBadge)}
              type="button"
            >
              Share achievement
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
