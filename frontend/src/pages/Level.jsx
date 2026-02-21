import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useProfile } from '../hooks/useProfile';
import { useUserLevel } from '../hooks/useUserLevel';
import { normalizeAddress } from '../services/profileService';
import './Level.css';

const LEVEL_MILESTONES = [1, 2, 3, 4, 5, 6, 7, 8];

export default function Level() {
  const navigate = useNavigate();
  const { account, connected } = useWallet();
  const address = normalizeAddress(account?.address);
  const { profile } = useProfile(address);
  const { level, xp, nextLevelXP, xpProgress, badges, loading } = useUserLevel(address);

  const remainingXP = useMemo(() => Math.max(0, nextLevelXP - xp), [nextLevelXP, xp]);
  const earnedBadges = badges || [];

  return (
    <div className="level-page">
      <div className="level-container">
        <div className="level-header">
          <button onClick={() => navigate(-1)} className="level-back-btn">
            ←
          </button>
          <h1>Level</h1>
        </div>

        {!connected ? (
          <div className="level-empty">Connect your wallet to view your level.</div>
        ) : (
          <>
            <div className="level-profile">
              <div className="level-avatar">
                <img src={profile?.pfp || '/pfp.PNG'} alt="Profile" className="level-avatar-image" />
                {!loading && <div className="level-avatar-badge">{level}</div>}
              </div>
              <div className="level-profile-info">
                <div className="level-username">{profile?.username || 'Anonymous User'}</div>
                <div className="level-address">
                  {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
                </div>
              </div>
            </div>

            <div className="level-stats-card">
              <div className="level-stats-row">
                <div className="level-stat-label">Current Level</div>
                <div className="level-stat-value">{loading ? '--' : level}</div>
              </div>
              <div className="level-stats-row">
                <div className="level-stat-label">Experience Points</div>
                <div className="level-stat-value">
                  {loading ? '--' : `${xp} / ${nextLevelXP}`}
                </div>
              </div>
              <div className="level-progress-bar">
                <div className="level-progress-fill" style={{ width: `${xpProgress}%` }} />
              </div>
              <div className="level-remaining">{loading ? '' : `${remainingXP} XP to next level`}</div>
            </div>

            <div className="level-progression-card">
              <div className="level-section-title">Level Progression</div>
              <div className="level-progression-list">
                {LEVEL_MILESTONES.map((milestoneLevel) => {
                  const unlocked = level >= milestoneLevel;
                  return (
                    <div
                      key={milestoneLevel}
                      className={`level-progression-item ${unlocked ? 'is-unlocked' : 'is-locked'}`}
                    >
                      <div className="progression-level">Level {milestoneLevel}</div>
                      <div className="progression-reward">Reward: </div>
                      <div className="progression-status">{unlocked ? 'Unlocked' : 'Locked'}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="level-badges-card">
              <div className="level-section-title">Collected Badges ({earnedBadges.length})</div>
              {earnedBadges.length === 0 ? (
                <div className="level-empty">No badges earned yet. Mint badges to level up!</div>
              ) : (
                <div className="level-badges-grid">
                  {earnedBadges.map((badge) => (
                    <div key={badge.id} className="level-badge-item">
                      <div className="level-badge-icon">
                        <span>{badge.icon || '🏆'}</span>
                      </div>
                      <div className="level-badge-info">
                        <div className="level-badge-name">{badge.name}</div>
                        <div className="level-badge-description">{badge.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
