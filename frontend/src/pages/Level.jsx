import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useProfile } from '../hooks/useProfile';
import { useUserLevel } from '../hooks/useUserLevel';
import { normalizeAddress } from '../services/profileService';
import { getXPForLevel } from '../config/badges';
import { DEFAULT_LEVEL_PFP, getLevelBasedPfp } from '../utils/levelPfp';
import './Level.css';

const LEVEL_REWARDS = [
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
  'TBD',
];

export default function Level() {
  const navigate = useNavigate();
  const { account, connected } = useWallet();
  const address = normalizeAddress(account?.address);
  const { profile } = useProfile(address);
  const { level, xp, nextLevelXP, xpProgress, badges, loading } = useUserLevel(address);

  const remainingXP = useMemo(() => Math.max(0, nextLevelXP - xp), [nextLevelXP, xp]);
  const currentLevel = loading ? 1 : level;
  const cappedCurrentLevel = Math.min(currentLevel, 20);
  const progressWidth = Math.max(0, Math.min(100, xpProgress || 0));
  const earnedBadges = badges?.length || 0;
  const roadmap = LEVEL_REWARDS.map((reward, index) => {
    const levelNumber = index + 1;
    const requiredXP = getXPForLevel(levelNumber);
    const isCurrent = !loading && cappedCurrentLevel === levelNumber;
    const isUnlocked = !loading && currentLevel >= levelNumber;

    return {
      levelNumber,
      reward,
      requiredXP,
      isCurrent,
      isUnlocked,
    };
  });
  const profileImageSrc = getLevelBasedPfp({
    level: currentLevel,
    address,
    preferredPfp: profile?.pfp,
  });

  return (
    <div className="level-page">
      <div className="level-container">
        <div className="level-header">
          <h1>Level</h1>
        </div>

        {!connected ? (
          <div className="level-empty level-empty-card">
            <div className="level-empty-icon">🔐</div>
            <div className="level-empty-text">Connect your wallet to view your level.</div>
          </div>
        ) : (
          <>
            <section className="level-overview">
              <article className="level-identity-card">
                <div className="level-avatar-wrapper">
                  <div className="level-avatar-circle">
                    <img
                      src={profileImageSrc}
                      alt="Profile"
                      className="level-avatar-image"
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = DEFAULT_LEVEL_PFP;
                      }}
                    />
                  </div>
                </div>
                <div className="level-identity-footer">
                  <span>{profile?.username || (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Anonymous')}</span>
                </div>
              </article>

              <article className="level-stats-card">
                <div className="level-card-label">Current Progress</div>
                <div className="level-stats-grid">
                  <div className="level-stat-box">
                    <span className="level-stat-key">Level</span>
                    <span className="level-stat-value">{loading ? '--' : currentLevel}</span>
                  </div>
                  <div className="level-stat-box">
                    <span className="level-stat-key">XP</span>
                    <span className="level-stat-value">{loading ? '--' : xp}</span>
                  </div>
                  <div className="level-stat-box">
                    <span className="level-stat-key">Badges</span>
                    <span className="level-stat-value">{loading ? '--' : earnedBadges}</span>
                  </div>
                </div>
                <div className="level-progress-row">
                  <div className="level-progress-track">
                    <div className="level-progress-fill" style={{ width: `${progressWidth}%` }} />
                  </div>
                  <span className="level-progress-text">
                    {loading ? 'Calculating...' : `${remainingXP} XP to next level`}
                  </span>
                </div>
              </article>
            </section>

            <section className="level-main-panel">
              <div className="level-roadmap-header">
                <div>
                  <h2>Level Rewards Roadmap</h2>
                  <p>Unlock rewards from Level 1 to Level 20 by earning XP.</p>
                </div>
                <button className="level-leaderboard-btn" onClick={() => navigate('/leaderboard')}>
                  Leaderboard
                </button>
              </div>

              <div className="level-roadmap-grid">
                {roadmap.map((item) => (
                  <article
                    key={item.levelNumber}
                    className={`level-roadmap-card ${
                      item.isCurrent ? 'is-current' : item.isUnlocked ? 'is-unlocked' : 'is-locked'
                    }`}
                  >
                    <div className="level-roadmap-top">
                      <span className="level-roadmap-level">Level {item.levelNumber}</span>
                      <span className="level-roadmap-status">
                        {item.isCurrent ? 'Current' : item.isUnlocked ? 'Unlocked' : 'Locked'}
                      </span>
                    </div>
                    <p className="level-roadmap-reward">{item.reward}</p>
                    <p className="level-roadmap-xp">Required XP: {item.requiredXP}</p>
                  </article>
                ))}
              </div>

              {!loading && currentLevel > 20 && (
                <div className="level-max-note">
                  You are above Level 20. All roadmap rewards are unlocked.
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
