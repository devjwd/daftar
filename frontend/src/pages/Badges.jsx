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
import { useMovementClient } from '../hooks/useMovementClient.js';
import { awardBadge } from '../services/badges/badgeStore.js';
import { mintBadge } from '../services/badgeService.js';
import { requestMintSignature } from '../services/badgeApi.js';
import { confirmMintAndOwnership } from '../services/badges/mintVerification.js';
import { bulkCheckEligibility } from '../services/badges/engineService.js';
import useBadges from '../hooks/useBadges.js';
import useBadgeEligibility from '../hooks/useBadgeEligibility.js';
import { t, getStoredLanguagePreference } from '../utils/language';
import { getSettingsStorageKey } from '../utils/settings';

const getProgressMessage = (progress, fallbackReason, language) => {
  const current = Number(progress?.current);
  const required = Number(progress?.required);

  if (Number.isFinite(current) && Number.isFinite(required) && required > 0) {
    const ratio = current / required;
    const suffix = ratio >= 0.9 ? t(language, 'badgesAlmostThere') : t(language, 'badgesKeepGoing');
    return `${Math.floor(current)}/${Math.floor(required)} — ${suffix}`;
  }

  return fallbackReason || t(language, 'badgesNotEligible');
};

function BadgeEligibilityActions({ badge, minting, onMint, disabled, language }) {
  const { status, progress, reason, checkEligibility, isLoading } = useBadgeEligibility(badge);

  const effectiveStatus = badge?.earned
    ? 'already_owned'
    : badge?.eligible
      ? 'eligible'
      : status;

  if (disabled) {
    return <p className="achievement-muted-note">{t(language, 'badgesCampaignEnded')}</p>;
  }

  if (isLoading || effectiveStatus === 'loading') {
    return <p className="achievement-muted-note">{t(language, 'badgesChecking')}</p>;
  }

  if (effectiveStatus === 'eligible') {
    return (
      <div className="achievement-eligible-wrap">
        <span className="achievement-ok">✓ {t(language, 'badgesEligible')}</span>
        <button
          className="achievement-claim-btn"
          onClick={(event) => {
            event.stopPropagation();
            onMint(badge);
          }}
          disabled={minting || disabled}
        >
          {minting ? t(language, 'badgesClaiming') : t(language, 'badgesClaim')}
        </button>
      </div>
    );
  }

  if (effectiveStatus === 'not_eligible') {
    const progressMessage = getProgressMessage(progress, reason, language);
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
          {t(language, 'badgesRecheck')}
        </button>
      </div>
    );
  }

  if (effectiveStatus === 'already_owned') {
    return (
      <button className="achievement-check-btn" disabled type="button">
        {t(language, 'badgesOwned')}
      </button>
    );
  }

  if (effectiveStatus === 'requires_admin') {
    return <p className="achievement-muted-note">{t(language, 'badgesContactAdmin')}</p>;
  }

  if (effectiveStatus === 'error') {
    return (
      <div className="achievement-not-eligible-wrap">
        <p className="achievement-muted-note">{t(language, 'badgesCheckFailed')}</p>
        {reason ? <p className="achievement-muted-note achievement-muted-note-small">{reason}</p> : null}
        <button
          className="achievement-check-btn"
          onClick={(event) => {
            event.stopPropagation();
            checkEligibility({ force: true });
          }}
          type="button"
        >
          {t(language, 'badgesRetry')}
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
      {t(language, 'badgesChecking')}
    </button>
  );
}

export default function Badges() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const address = connected && account?.address
    ? (typeof account.address === 'string' ? account.address : account.address.toString())
    : null;

  const [language, setLanguage] = useState(() => getStoredLanguagePreference(getSettingsStorageKey(address)));
  const [lifecycleTab, setLifecycleTab] = useState('active');
  const [mintingIds, setMintingIds] = useState(new Set());
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [claimedAnimIds, setClaimedAnimIds] = useState(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState({});

  const { client: movementClient, loading: movementClientLoading } = useMovementClient();
  const {
    badges,
    totalBadges,
    earnedCount,
    completionPercent,
    loading,
    refresh,
  } = useBadges(address, {
    client: movementClient,
    clientLoading: movementClientLoading,
    enablePolling: false,
  });

  const earnedLabel = t(language, 'badgesEarned', { earned: earnedCount, total: totalBadges });

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

  const handleDeepScan = useCallback(async () => {
    if (!address || !visibleBadges.length) return;
    setIsScanning(true);
    try {
      const results = await bulkCheckEligibility(address, visibleBadges);
      setScanResults(results);
      const eligibleCount = Object.values(results).filter(r => r.eligible).length;
      setSuccessMsg(t(language, 'badgesScanResults', { count: eligibleCount }));
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(t(language, 'badgesScanFailed'));
    } finally {
      setIsScanning(false);
    }
  }, [address, visibleBadges]);

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
      setSuccessMsg(t(language, 'badgesMintSuccessSyncFail'));
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
    const shareTitle = t(language, 'badgesShareTitle', { name: badge.name }) || `${badge.name} achievement`;
    const shareText = `${badge.name} - ${badge.description || t(language, 'badgesDescriptionFallback')}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${shareTitle}\n${shareText}`);
        setSuccessMsg(t(language, 'badgesShareSuccess'));
        setTimeout(() => setSuccessMsg(''), 2500);
      } else {
        setError(t(language, 'badgesShareNotSupported'));
        setTimeout(() => setError(''), 2500);
      }
    } catch (err) {
      // Ignore abort errors from dismissed native share sheet.
      if (err?.name !== 'AbortError') {
        setError(t(language, 'badgesShareError'));
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
          <p>{badge.description || t(language, 'badgesDescriptionFallback')}</p>

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
            language={language}
          />

          {badge.earned && <span className="achievement-status-pill">{t(language, 'badgesAchievements')}</span>}
          {!badge.earned && !badge.eligible && !badge.attestationPending && !badge.attestationFailed && <span className="achievement-status-pill">{t(language, 'badgesLocked')}</span>}
          {badge.publishPending && <span className="achievement-status-pill">{t(language, 'badgesPublishing')}</span>}
          {badge.attestationPending && <span className="achievement-status-pill">{t(language, 'badgesAttesting')}</span>}
          {badge.attestationFailed && <span className="achievement-status-pill achievement-status-pill--warn" title={t(language, 'badgesAttestationFailedNote')}>{t(language, 'badgesAttestationFailed')}</span>}

          <span className="achievement-chevron" aria-hidden="true">›</span>
        </div>
      </article>
    );
  };

  // Mint handler
  const handleMint = useCallback(async (badge) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      setError(t(language, 'badgesConnectToClaim'));
      return;
    }
    if (!movementClient) {
      setError(t(language, 'badgesClientLoading'));
      return;
    }

    setError('');
    setSuccessMsg('');
    setMintingIds(prev => new Set([...prev, badge.id]));

    try {
      if (badge.onChainBadgeId == null) {
        throw new Error(t(language, 'badgesNotPublished'));
      }

      let txHash = null;
      const senderAddress = typeof account.address === 'string' ? account.address : account.address.toString();
      const sigResult = await requestMintSignature(senderAddress, badge.onChainBadgeId);
      if (!sigResult.ok) {
        throw new Error(sigResult.error || t(language, 'badgesMintAuthFailed'));
      }

      const tx = await mintBadge({
        client: movementClient,
        signAndSubmitTransaction,
        sender: senderAddress,
        badgeId: badge.onChainBadgeId,
        signatureBytes: sigResult.signatureBytes,
        validUntil: sigResult.validUntil,
        badge,
      });
      txHash = await confirmMintAndOwnership({
        client: movementClient,
        txResponse: tx,
        badgeId: badge.onChainBadgeId,
        owner: senderAddress,
      });

      let syncOk = true;
      try {
        syncOk = await syncBadgeMint({ senderAddress, badge, txHash });
      } catch (syncError) {
        syncOk = false;
        setSuccessMsg(t(language, 'badgesMintSuccessSyncFail'));
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
        setSuccessMsg(t(language, 'badgesClaimSuccess', { badgeName: badge.name }));
        setTimeout(() => setSuccessMsg(''), 4000);
      }
    } catch (err) {
      console.error('Mint error:', err);
      setError(err.message || t(language, 'badgesCheckFailed'));
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
            <span className="badges-eyebrow">{t(language, 'badgesAchievements')}</span>
            <h1>{t(language, 'badgesTitle')}</h1>
            <p>{t(language, 'badgesSubtitle')}</p>
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
            <p>{t(language, 'badgesConnectPrompt')}</p>
          </div>
        )}

        {/* Loading */}
        {connected && loading && totalBadges > 0 && badgesWithLifecycle.length === 0 && (
          <div className="badges-loading">
            <div className="badges-spinner" />
            <p>{t(language, 'badgesChecking')}</p>
          </div>
        )}

        {/* No badges defined yet */}
        {connected && !loading && totalBadges === 0 && (
          <div className="badges-empty">
            <p>{t(language, 'badgesNoBadgesAvailable')}</p>
          </div>
        )}

        {/* Badge Sections */}
        {connected && badgesWithLifecycle.length > 0 && (
          <>
            {/* Real-time indicator */}
            {loading && (
              <div className="badges-realtime-indicator">
                <span className="badges-pulse-dot" />
                {t(language, 'badgesChecking')}
              </div>
            )}

            {/* Refresh button */}
            <div className="badges-toolbar">
              <button 
                className={`badges-scan-btn ${isScanning ? 'is-scanning' : ''}`} 
                onClick={handleDeepScan} 
                disabled={loading || isScanning}
              >
                {isScanning ? t(language, 'badgesScanning') : t(language, 'badgesDeepScan')}
              </button>
              <button className="badges-refresh-btn" onClick={refresh} disabled={loading || isScanning}>
                ↻ {t(language, 'badgesRefresh')}
              </button>
            </div>

            <div className="achievement-tabs" role="tablist" aria-label="Badge lifecycle filters">
              <button
                className={`achievement-tab ${lifecycleTab === 'active' ? 'is-active' : ''}`}
                onClick={() => setLifecycleTab('active')}
                role="tab"
                aria-selected={lifecycleTab === 'active'}
              >
                {t(language, 'badgesActive')}
                <span>{activeBadges.length}</span>
              </button>
              <button
                className={`achievement-tab ${lifecycleTab === 'expired' ? 'is-active' : ''}`}
                onClick={() => setLifecycleTab('expired')}
                role="tab"
                aria-selected={lifecycleTab === 'expired'}
              >
                {t(language, 'badgesExpired')}
                <span>{expiredBadges.length}</span>
              </button>
            </div>

            {visibleBadges.length === 0 && (
              <div className="badges-empty">
                <p>{lifecycleTab === 'expired' ? t(language, 'badgesNoExpired') : t(language, 'badgesNoActive')}</p>
              </div>
            )}

            {visibleBadges.length > 0 && (
              <>
                <section className="badges-section">
                  <h2 className="badges-section-title">
                    {t(language, 'badgesCompleted')}
                    <span className="badges-section-count">{completedBadges.length}</span>
                    <small>{t(language, 'badgesCompletedNote')}</small>
                  </h2>
                  <div className="achievement-grid">
                    {completedBadges.map(renderAchievementCard)}
                  </div>
                </section>

                <section className="badges-section">
                  <h2 className="badges-section-title">
                    {t(language, 'badgesIncomplete')}
                    <span className="badges-section-count">{incompleteBadges.length}</span>
                    <small>{t(language, 'badgesIncompleteNote')}</small>
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
            <p>{selectedBadge.description || t(language, 'badgesDescriptionFallback')}</p>

            <div className="badge-modal-meta">
              {selectedBadge.earned && <span className="badge-modal-pill is-earned">{t(language, 'badgesAchievements')}</span>}
              {selectedBadge.eligible && !selectedBadge.earned && <span className="badge-modal-pill is-claim">{t(language, 'badgesReadyToClaim')}</span>}
              {!selectedBadge.earned && !selectedBadge.eligible && <span className="badge-modal-pill is-locked">{t(language, 'badgesInProgress')}</span>}
            </div>

            {selectedBadge.attestationPending && (
              <p className="badge-modal-note">
                {t(language, 'badgesAttestationNote')}
              </p>
            )}
            {selectedBadge.attestationFailed && (
              <p className="badge-modal-note badge-modal-note--warn">
                {t(language, 'badgesAttestationFailedNote')}
              </p>
            )}

            <button
              className="badge-modal-share"
              onClick={() => handleShareBadge(selectedBadge)}
              type="button"
            >
              {t(language, 'badgesShare')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
