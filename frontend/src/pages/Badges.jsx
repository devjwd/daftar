import './Badges.css';
import { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { DEFAULT_NETWORK } from '../config/network';
import {
  fetchBadges,
  hasBadge,
  isAllowlisted,
  getCoinBalance,
  mintBadge,
  mintBadgeWithBalance,
  ruleLabel,
} from '../services/badgeService';
import {
  BADGE_RULES,
  ACTIVITY_BADGE_TIERS,
  LONGEVITY_BADGE_TIERS,
} from '../config/badges';
import {
  getTransactionCount,
  getDaysOnchain,
} from '../services/eligibilityService';
import BadgeCard from '../components/BadgeCard';

export default function Badges() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [onChainBadges, setOnChainBadges] = useState([]);
  const [userBadges, setUserBadges] = useState(new Set());
  const [eligibilityMap, setEligibilityMap] = useState({});
  const [loadingBadges, setLoadingBadges] = useState(false);
  const [minting, setMinting] = useState({});
  const [error, setError] = useState('');
  const [userTxCount, setUserTxCount] = useState(0);
  const [userDaysOnchain, setUserDaysOnchain] = useState(0);

  const movementClient = useMemo(
    () =>
      new Aptos(
        new AptosConfig({
          network: Network.CUSTOM,
          fullnode: DEFAULT_NETWORK.rpc,
        })
      ),
    []
  );

  // Load badges on mount
  useEffect(() => {
    const loadBadgesData = async () => {
      setLoadingBadges(true);
      try {
        const badges = await fetchBadges(movementClient);
        setOnChainBadges(badges);
      } catch (err) {
        console.error('Failed to load badges:', err);
      } finally {
        setLoadingBadges(false);
      }
    };

    loadBadgesData();
  }, []);

  // Load user stats and eligibility
  useEffect(() => {
    if (!account?.address || !onChainBadges.length) return;

    const checkEligibility = async () => {
      const owned = new Set();
      const eligible = {};

      try {
        for (const badge of onChainBadges) {
          // Check if already minted
          const hasMinted = await hasBadge(movementClient, badge.id, account.address.toString());
          if (hasMinted) {
            owned.add(badge.id);
          }

          // Check eligibility based on rule type
          if (badge.ruleType === BADGE_RULES.ALLOWLIST) {
            const allowlisted = await isAllowlisted(movementClient, badge.id, account.address.toString());
            eligible[badge.id] = allowlisted && !hasMinted;
          } else if (badge.ruleType === BADGE_RULES.MIN_BALANCE) {
            const balance = await getCoinBalance(movementClient, account.address.toString(), badge.coinTypeStr);
            eligible[badge.id] = balance >= badge.minBalance && !hasMinted;
          } else {
            eligible[badge.id] = false;
          }
        }

        setUserBadges(owned);
        setEligibilityMap(eligible);
      } catch (err) {
        console.error('Failed to check eligibility:', err);
      }
    };

    checkEligibility();
  }, [account, onChainBadges]);

  useEffect(() => {
    if (!account?.address) return;

    const loadUserProgressStats = async () => {
      try {
        const userAddress = account.address.toString();
        const [txCount, daysOnchain] = await Promise.all([
          getTransactionCount(userAddress),
          getDaysOnchain(userAddress),
        ]);

        setUserTxCount(Number(txCount) || 0);
        setUserDaysOnchain(Number(daysOnchain) || 0);
      } catch (err) {
        console.error('Failed to load user progression stats:', err);
        setUserTxCount(0);
        setUserDaysOnchain(0);
      }
    };

    loadUserProgressStats();
  }, [account]);

  const handleMintBadge = async (badge) => {
    if (!connected || !account || !signAndSubmitTransaction) {
      setError('Please connect your wallet');
      return;
    }

    setMinting((prev) => ({ ...prev, [badge.id]: true }));
    setError('');

    try {
      if (badge.ruleType === BADGE_RULES.MIN_BALANCE) {
        await mintBadgeWithBalance({
          signAndSubmitTransaction,
          sender: account.address,
          badgeId: badge.id,
          coinType: badge.coinTypeStr,
        });
      } else {
        await mintBadge({
          signAndSubmitTransaction,
          sender: account.address,
          badgeId: badge.id,
        });
      }

      // Refresh eligibility
      const owned = new Set([...userBadges, badge.id]);
      setUserBadges(owned);
      setEligibilityMap((prev) => ({ ...prev, [badge.id]: false }));
    } catch (err) {
      console.error('Mint error:', err);
      setError(err.message || 'Failed to mint badge');
    } finally {
      setMinting((prev) => ({ ...prev, [badge.id]: false }));
    }
  };

  const getNumericThreshold = (badge) => {
    if (typeof badge.minBalance === 'number' && badge.minBalance > 0) {
      return badge.minBalance;
    }

    if (!badge.ruleNote) return 0;

    const matched = String(badge.ruleNote).match(/\d+(\.\d+)?/);
    return matched ? Number(matched[0]) : 0;
  };

  const getGamificationMeta = (badge) => {
    if (badge.ruleType === BADGE_RULES.TRANSACTION_COUNT) {
      const threshold = getNumericThreshold(badge) || 1;
      const tier = ACTIVITY_BADGE_TIERS.find((item) => item.count === threshold);

      return {
        rarity: tier?.rarity || 'COMMON',
        xp: tier?.xp || 10,
        percentile: tier?.percentileThreshold ?? null,
        progress: userTxCount,
        progressMax: threshold,
        nextMilestone: threshold,
      };
    }

    if (badge.ruleType === BADGE_RULES.DAYS_ONCHAIN) {
      const threshold = getNumericThreshold(badge) || 1;
      const tier = LONGEVITY_BADGE_TIERS.find((item) => item.days === threshold);

      return {
        rarity: tier?.rarity || 'COMMON',
        xp: tier?.xp || 10,
        percentile: tier?.percentileThreshold ?? null,
        progress: userDaysOnchain,
        progressMax: threshold,
        nextMilestone: threshold,
      };
    }

    return {
      rarity: badge.rarity || 'COMMON',
      xp: badge.xp || 10,
      percentile: null,
      progress: 0,
      progressMax: 0,
      nextMilestone: null,
    };
  };

  // Enhance badges with criteria and gamification meta
  const enhancedBadges = onChainBadges.map((badge) => {
    let criteria = ruleLabel(badge.ruleType);
    if (badge.ruleNote) {
      criteria += ` - ${badge.ruleNote}`;
    }

    const gamification = getGamificationMeta(badge);

    return {
      ...badge,
      criteria,
      ...gamification,
    };
  });

  const handleEarnedBadges = enhancedBadges.filter((b) => userBadges.has(b.id));
  const handleLocked = enhancedBadges.filter((b) => !userBadges.has(b.id) && !eligibilityMap[b.id]);
  const handleEligible = enhancedBadges.filter((b) => eligibilityMap[b.id]);

  const completionPercent = onChainBadges.length > 0 ? (handleEarnedBadges.length / onChainBadges.length) * 100 : 0;

  return (
    <div className="badges-page">
      <div className="badges-container">
        {/* Header */}
        <div className="badges-header">
          <div className="badges-header-text">
            <span className="badges-eyebrow">Achievements</span>
            <h1>Badges</h1>
            <p>Earn SBT achievements by participating in the Movement Network</p>
          </div>
          <div className="badges-progress">
            <span className="progress-text">
              {handleEarnedBadges.length} of {onChainBadges.length} Earned
            </span>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${completionPercent}%`,
                }}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="badges-error" style={{ marginBottom: '20px' }}>
            {error}
          </div>
        )}

        {loadingBadges ? (
          <div className="badges-loading">Loading badges...</div>
        ) : onChainBadges.length === 0 ? (
          <div className="badges-empty">No badges available yet</div>
        ) : (
          <>
            {/* Eligible to Mint */}
            {handleEligible.length > 0 && (
              <section className="badges-section">
                <h2>🎁 Eligible to Mint</h2>
                <div className="badges-grid">
                  {handleEligible.map((badge) => (
                    <div key={badge.id} className="badge-action-card">
                      <BadgeCard
                        badge={badge}
                        earned={false}
                        progress={badge.progress}
                        progressMax={badge.progressMax}
                        nextMilestone={badge.nextMilestone}
                        percentile={badge.percentile}
                        xp={badge.xp}
                        showEligibility
                      />
                      <button
                        className="mint-btn"
                        onClick={() => handleMintBadge(badge)}
                        disabled={minting[badge.id]}
                      >
                        {minting[badge.id] ? '⏳ Minting...' : '✨ Mint SBT'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Your Badges */}
            {handleEarnedBadges.length > 0 && (
              <section className="badges-section">
                <h2>✅ Your Badges</h2>
                <div className="badges-grid">
                  {handleEarnedBadges.map((badge) => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      earned
                      progress={badge.progress}
                      progressMax={badge.progressMax}
                      nextMilestone={badge.nextMilestone}
                      percentile={badge.percentile}
                      xp={badge.xp}
                      showEligibility
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Locked Badges */}
            {handleLocked.length > 0 && (
              <section className="badges-section">
                <h2>🔒 Locked</h2>
                <div className="badges-grid">
                  {handleLocked.map((badge) => (
                    <BadgeCard
                      key={badge.id}
                      badge={badge}
                      earned={false}
                      progress={badge.progress}
                      progressMax={badge.progressMax}
                      nextMilestone={badge.nextMilestone}
                      percentile={badge.percentile}
                      xp={badge.xp}
                      showEligibility
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
