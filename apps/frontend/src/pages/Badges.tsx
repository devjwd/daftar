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
import { useMovementClient } from '../hooks/useMovementClient';
import { awardBadge } from '../services/badges/badgeStore';
import { mintBadge } from '../services/badgeService';
import { requestMintSignature } from '../services/api';
import { confirmMintAndOwnership } from '../services/badges/mintVerification';
import { bulkCheckEligibility } from '../services/badges/engineService';
import { useBadges } from '../hooks/useBadges';
import { useBadgeEligibility } from '../hooks/useBadgeEligibility';
import { t, getStoredLanguagePreference } from '../utils/language';
import { getSettingsStorageKey } from '../utils/settings';
import {
  getLevelProgress,
  getRarityInfo,
  BADGE_RARITY,
  getLevelFromXP,
  getNextLevelXP,
  CRITERIA_LABELS
} from '../config/badges';

const getProgressMessage = (progress, fallbackReason, language) => {
  const current = Number(progress?.current);
  const target = Number(progress?.target);

  if (Number.isFinite(current) && Number.isFinite(target) && target > 0) {
    const ratio = current / target;
    const suffix = ratio >= 0.9 ? t(language, 'badgesAlmostThere') : t(language, 'badgesKeepGoing');
    return `${Math.floor(current)}/${Math.floor(target)} — ${suffix}`;
  }

  return fallbackReason || t(language, 'badgesNotEligible');
};

function BadgeEligibilityActions({ badge, minting, onMint, disabled, language, client }) {
  const { status, progress, reason, checkEligibility, isLoading } = useBadgeEligibility(badge, client);

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
    const width = Number(progress?.target) > 0
      ? Math.max(4, Math.min(100, (Number(progress?.current || 0) / Number(progress.target)) * 100))
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

function BadgeSummary({ earnedCount, totalCount }) {
  const percentage = totalCount > 0 ? (earnedCount / totalCount) * 100 : 0;

  return (
    <div className="badge-summary-minimal">
      <div className="summary-text">
        {earnedCount} of {totalCount} Earned
      </div>
      <div className="summary-progress-bar">
        <div className="summary-progress-fill" style={{ width: `${percentage}%` }} />
      </div>
    </div>
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
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState({});

  const { client: movementClient, loading: movementClientLoading } = useMovementClient();
  const {
    badges,
    totalBadges,
    earnedCount,
    loading,
    refresh,
  } = useBadges(address, {
    client: movementClient,
    clientLoading: movementClientLoading,
    enablePolling: false,
  });

  const isBadgeExpired = useCallback((badge) => {
    const timeLimited = badge?.metadata?.special?.timeLimited;
    if (!timeLimited?.enabled || !timeLimited?.endsAt) return false;
    const endsAtMs = Date.parse(timeLimited.endsAt);
    return Number.isFinite(endsAtMs) && endsAtMs < Date.now();
  }, []);

  const badgesWithLifecycle = useMemo(
    () => badges.map((badge) => {
      const scanResult = scanResults[badge.id];
      return {
        ...badge,
        isExpired: isBadgeExpired(badge),
        eligible: badge.eligible || scanResult?.eligible || false,
        progress: badge.progress || scanResult?.progress || 0,
        reason: badge.reason || scanResult?.reason || null
      };
    }),
    [badges, isBadgeExpired, scanResults]
  );

  const activeBadges = useMemo(() => badgesWithLifecycle.filter(b => !b.isExpired), [badgesWithLifecycle]);
  const expiredBadges = useMemo(() => badgesWithLifecycle.filter(b => b.isExpired), [badgesWithLifecycle]);
  const visibleBadges = lifecycleTab === 'expired' ? expiredBadges : activeBadges;

  const earnedBadges = useMemo(() => visibleBadges.filter(b => b.earned), [visibleBadges]);
  const availableBadges = useMemo(() => visibleBadges.filter(b => !b.earned), [visibleBadges]);

  // Auto-scan on mount or address change (Smart Cache optimized)
  useEffect(() => {
    if (address && visibleBadges.length > 0 && !isScanning && Object.keys(scanResults).length === 0) {
      const runInitialScan = async () => {
        setIsScanning(true);
        try {
          const results = await bulkCheckEligibility(address, visibleBadges);
          const resultsMap = {};
          results.forEach(r => { resultsMap[r.id] = r; });
          setScanResults(resultsMap);
        } catch (err) {
          console.warn('[Badges] Initial scan failed:', err);
        } finally {
          setIsScanning(false);
        }
      };
      runInitialScan();
    }
  }, [address, visibleBadges.length]);

  const handleDeepScan = async () => {
    if (!address || !visibleBadges.length) return;
    setIsScanning(true);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      // Optional: sync transactions first to ensure latest data
      await fetch(`${baseUrl}/api/transactions/sync?wallet=${address}`).catch(() => { });

      // Force a fresh calculation on the server
      const results = await bulkCheckEligibility(address, visibleBadges, { force: true });
      const resultsMap = {};
      results.forEach(r => { resultsMap[r.id] = r; });
      setScanResults(resultsMap);
      await refresh();
      setSuccessMsg(t(language, 'badgesScanResults', { count: results.filter(r => r.eligible).length }));
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(t(language, 'badgesScanFailed'));
    } finally {
      setIsScanning(false);
    }
  };

  const handleMint = async (badge) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      setError(t(language, 'badgesConnectToClaim'));
      return;
    }
    setMintingIds(prev => new Set([...prev, badge.id]));
    try {
      const senderAddress = typeof account.address === 'string' ? account.address : account.address.toString();
      const sigResult = await requestMintSignature(senderAddress, badge.id);
      if (!sigResult.ok) throw new Error(sigResult.error || t(language, 'badgesMintAuthFailed'));

      const tx = await mintBadge({
        client: movementClient,
        signAndSubmitTransaction,
        sender: senderAddress,
        badgeId: badge.onChainBadgeId,
        signatureBytes: sigResult.signatureBytes,
        validUntil: sigResult.validUntil,
        signerEpoch: sigResult.signerEpoch,
        nonce: sigResult.nonce,
        badge,
      });

      const txHash = await confirmMintAndOwnership({
        client: movementClient,
        txResponse: tx,
        badgeId: badge.onChainBadgeId,
        owner: senderAddress,
      });

      await fetch(`${import.meta.env.VITE_API_URL}/api/badges/sync`, {
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

      await refresh();
      setSuccessMsg(t(language, 'badgesClaimSuccess', { badgeName: badge.name }));
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message || t(language, 'badgesCheckFailed'));
    } finally {
      setMintingIds(prev => {
        const next = new Set(prev);
        next.delete(badge.id);
        return next;
      });
    }
  };

  const renderBadgeCard = (badge) => {
    const isMinting = mintingIds.has(badge.id);
    const status = badge.earned ? 'earned' : badge.eligible ? 'eligible' : 'locked';

    return (
      <article
        key={badge.id}
        className={`achievement-card achievement-${status}`}
        onClick={() => setSelectedBadge(badge)}
      >
        <div className="achievement-card-header">
          <div className="achievement-icon-wrap">
            {badge.imageUrl ? <img src={badge.imageUrl} alt="" className="achievement-icon-image" /> : (badge.emoji || '🏅')}
          </div>
          <div className="achievement-info">
            <h3>{badge.name}</h3>
            <p>{badge.description}</p>
          </div>
        </div>

        <div className="achievement-card-footer">
          <div className="achievement-status-group-wrap">
            <div className="achievement-status-group">
              <BadgeEligibilityActions
                badge={badge}
                minting={isMinting}
                onMint={handleMint}
                disabled={badge.isExpired}
                language={language}
                client={movementClient}
              />
              {badge.criteria && Array.isArray(badge.criteria) && badge.criteria.length > 0 && (
                <span className="achievement-criteria-label">
                  {badge.criteria.map(c => CRITERIA_LABELS[c.type] || c.type).join(' + ')}
                </span>
              )}
            </div>
          </div>

          {!badge.earned && !badge.eligible && badge.progress !== undefined && (
            <div className="achievement-card-progress">
              <div className="achievement-card-progress-bar">
                <div
                  className="achievement-card-progress-fill"
                  style={{
                    width: `${Math.min(100, typeof badge.progress === 'object'
                      ? (badge.progress.current / badge.progress.target) * 100
                      : badge.progress)}%`
                  }}
                />
              </div>
              <div className="achievement-progress-labels">
                <span className="achievement-progress-text">
                  {typeof badge.progress === 'object'
                    ? `${Math.floor(badge.progress.current)}/${Math.floor(badge.progress.target)}`
                    : `${Math.floor(badge.progress)}%`
                  }
                </span>
                <span className="achievement-progress-reason">
                  {getProgressMessage(badge.progress, badge.reason, language)}
                </span>
              </div>
            </div>
          )}
        </div>

        {badge.eligible && !badge.earned && (
          <button
            className="achievement-claim-btn"
            onClick={(e) => { e.stopPropagation(); handleMint(badge); }}
            disabled={isMinting}
          >
            {isMinting ? t(language, 'badgesClaiming') : t(language, 'badgesClaim')}
          </button>
        )}
      </article>
    );
  };

  return (
    <div className="badges-page">
      <div className="badges-container">
        <header className="badges-header">
          <div className="badges-header-left">
            <span className="badges-eyebrow">{t(language, 'badgesAchievements')}</span>
            <h1>{t(language, 'badgesTitle')}</h1>
            <p>{t(language, 'badgesSubtitle')}</p>
          </div>

          {address && (
            <div className="badges-header-right">
              <BadgeSummary earnedCount={earnedCount} totalCount={totalBadges} />
            </div>
          )}
        </header>

        {successMsg && <div className="badges-msg badges-msg-success">{successMsg}</div>}
        {error && <div className="badges-msg badges-msg-error">{error}</div>}

        <div className="badges-toolbar">
          <div className="achievement-tabs">
            <button
              className={`achievement-tab ${lifecycleTab === 'active' ? 'is-active' : ''}`}
              onClick={() => setLifecycleTab('active')}
            >
              {t(language, 'badgesActive')} <span>{activeBadges.length}</span>
            </button>
            <button
              className={`achievement-tab ${lifecycleTab === 'expired' ? 'is-active' : ''}`}
              onClick={() => setLifecycleTab('expired')}
            >
              {t(language, 'badgesExpired')} <span>{expiredBadges.length}</span>
            </button>
          </div>

          <div className="badges-actions-group">
            <button
              className="badges-scan-btn"
              onClick={handleDeepScan}
              disabled={isScanning || loading}
            >
              {isScanning ? t(language, 'badgesScanning') : t(language, 'badgesDeepScan')}
            </button>
            <button
              className="badges-refresh-btn"
              onClick={refresh}
              disabled={loading}
            >
              ↻
            </button>
          </div>
        </div>

        {loading && totalBadges === 0 ? (
          <div className="badges-loading">
            <div className="badges-spinner" />
            <p>{t(language, 'badgesChecking')}</p>
          </div>
        ) : (
          <>
            {earnedBadges.length > 0 && (
              <section className="badges-section">
                <h2 className="badges-section-title">
                  {t(language, 'badgesEarnedSection')}
                  <span className="badges-section-count">{earnedBadges.length}</span>
                </h2>
                <div className="achievement-grid">
                  {earnedBadges.map(renderBadgeCard)}
                </div>
              </section>
            )}

            {availableBadges.length > 0 && (
              <section className="badges-section">
                <h2 className="badges-section-title">
                  {t(language, 'badgesAvailableSection') || 'Available'}
                  <span className="badges-section-count">{availableBadges.length}</span>
                </h2>
                <div className="achievement-grid">
                  {availableBadges.map(renderBadgeCard)}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {selectedBadge && (
        <div className="badge-modal-backdrop" onClick={() => setSelectedBadge(null)}>
          <div className="badge-modal" onClick={e => e.stopPropagation()}>
            <button className="badge-modal-close" onClick={() => setSelectedBadge(null)}>×</button>
            <div className="badge-modal-icon-wrap">
              {selectedBadge.imageUrl ? <img src={selectedBadge.imageUrl} alt="" /> : (selectedBadge.emoji || '🏅')}
            </div>
            <h3>{selectedBadge.name}</h3>
            <p>{selectedBadge.description}</p>
            <button
              className="badge-modal-share"
              onClick={() => {
                navigator.clipboard.writeText(`${selectedBadge.name}: ${selectedBadge.description}`);
                setSuccessMsg(t(language, 'badgesShareSuccess'));
                setTimeout(() => setSuccessMsg(''), 2000);
              }}
            >
              {t(language, 'badgesShare')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
