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
import { BADGE_RULES } from '../config/badges';

export default function Badges() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [onChainBadges, setOnChainBadges] = useState([]);
  const [userBadges, setUserBadges] = useState(new Set());
  const [eligibilityMap, setEligibilityMap] = useState({});
  const [loadingBadges, setLoadingBadges] = useState(false);
  const [minting, setMinting] = useState({});
  const [error, setError] = useState('');

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

  // Load user eligibility when address changes
  useEffect(() => {
    if (!account?.address || !onChainBadges.length) return;

    const checkEligibility = async () => {
      const owned = new Set();
      const eligible = {};

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
    };

    checkEligibility();
  }, [account, onChainBadges]);

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

  const handleEarnedBadges = onChainBadges.filter((b) => userBadges.has(b.id));
  const handleLocked = onChainBadges.filter((b) => !userBadges.has(b.id) && !eligibilityMap[b.id]);
  const handleEligible = onChainBadges.filter((b) => eligibilityMap[b.id]);

  return (
    <div className="badges-page">
      <div className="badges-container">
        <div className="badges-header">
          <div className="badges-header-text">
            <span className="badges-eyebrow">Achievement Summary</span>
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
                  width: `${
                    onChainBadges.length > 0
                      ? (handleEarnedBadges.length / onChainBadges.length) * 100
                      : 0
                  }%`,
                }}
              ></div>
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
            {handleEligible.length > 0 && (
              <>
                <h2 style={{ marginTop: '40px', marginBottom: '20px', color: '#d4a574' }}>
                  🎁 Eligible to Mint
                </h2>
                <div className="badges-grid">
                  {handleEligible.map((badge) => (
                    <div key={badge.id} className="badge-card eligible">
                      {badge.imageUri ? (
                        <img src={badge.imageUri} alt={badge.name} className="badge-image" />
                      ) : (
                        <div className="badge-icon">🏆</div>
                      )}
                      <div className="badge-content">
                        <h3>{badge.name}</h3>
                        <p>{badge.description}</p>
                        <span className="badge-rule">{ruleLabel(badge.ruleType)}</span>
                        {badge.ruleNote && <p className="badge-note">Note: {badge.ruleNote}</p>}
                      </div>
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
              </>
            )}

            {handleEarnedBadges.length > 0 && (
              <>
                <h2 style={{ marginTop: '40px', marginBottom: '20px', color: '#d4a574' }}>
                  ✅ Your Badges
                </h2>
                <div className="badges-grid">
                  {handleEarnedBadges.map((badge) => (
                    <div key={badge.id} className="badge-card earned">
                      {badge.imageUri ? (
                        <img src={badge.imageUri} alt={badge.name} className="badge-image" />
                      ) : (
                        <div className="badge-icon">⭐</div>
                      )}
                      <div className="badge-content">
                        <h3>{badge.name}</h3>
                        <p>{badge.description}</p>
                        <span className="badge-minted">Minted on-chain</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {handleLocked.length > 0 && !handleEligible.length && (
              <>
                <h2 style={{ marginTop: '40px', marginBottom: '20px', color: '#8a7d6f' }}>
                  🔒 Locked
                </h2>
                <div className="badges-grid">
                  {handleLocked.map((badge) => (
                    <div key={badge.id} className="badge-card locked">
                      {badge.imageUri ? (
                        <img src={badge.imageUri} alt={badge.name} className="badge-image" />
                      ) : (
                        <div className="badge-icon">🔒</div>
                      )}
                      <div className="badge-content">
                        <h3>{badge.name}</h3>
                        <p>{badge.description}</p>
                        <span className="badge-locked">Locked</span>
                        <p className="badge-note">{ruleLabel(badge.ruleType)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
