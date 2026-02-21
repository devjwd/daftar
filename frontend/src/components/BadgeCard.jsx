import React, { useMemo } from 'react';
import { getRarityInfo } from '../config/badges';
import './BadgeCard.css';

/**
 * Gamified Badge Card Component
 * Displays badge with rarity, progress, XP, and eligibility info
 */
const BadgeCard = ({
  badge,
  earned = false,
  earnedDate = null,
  progress = 0,
  progressMax = 100,
  nextMilestone = null,
  percentile = null,
  xp = 0,
  onClick = null,
  showEligibility = true,
}) => {
  const rarity = useMemo(() => getRarityInfo(badge.rarity || 'COMMON'), [badge.rarity]);
  
  const progressPercent = useMemo(() => {
    if (progressMax === 0) return 0;
    return Math.min(100, Math.max(0, (progress / progressMax) * 100));
  }, [progress, progressMax]);

  const isUnlocked = earned || progressPercent >= 100;
  const daysUntilMilestone = nextMilestone ? Math.max(0, nextMilestone - progress) : null;

  return (
    <div
      className={`badge-card ${earned ? 'earned' : 'unearned'} rarity-${badge.rarity || 'COMMON'}`}
      style={{
        '--rarity-color': rarity.color,
        '--rarity-border': rarity.borderColor,
        '--rarity-glow': rarity.glowColor,
        '--rarity-bg': rarity.bgGradient,
      }}
      onClick={onClick}
    >
      {/* Rarity Glow Effect */}
      <div className="badge-glow" />

      {/* Earned Badge */}
      {earned && <div className="badge-earned-overlay">✓ EARNED</div>}

      {/* Badge Image Section */}
      <div className="badge-image-section">
        {badge.imageUri ? (
          <img src={badge.imageUri} alt={badge.name} className="badge-image" />
        ) : (
          <div className="badge-placeholder">{badge.emoji || '🏆'}</div>
        )}
        
        {/* Rarity Badge */}
        <div className="rarity-badge" style={{ backgroundColor: rarity.color }}>
          <span className="rarity-text">{rarity.name}</span>
        </div>

        {/* XP Badge */}
        {xp > 0 && (
          <div className="xp-badge">
            <span className="xp-text">+{xp} XP</span>
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="badge-content">
        {/* Header */}
        <div className="badge-header">
          <h3 className="badge-name">{badge.name}</h3>
          {percentile !== null && percentile !== undefined && (
            <div className="percentile-badge">
              Top {percentile}%
            </div>
          )}
        </div>

        {/* Description */}
        <p className="badge-description">{badge.description}</p>

        {/* Criteria/Eligibility */}
        {showEligibility && badge.criteria && (
          <div className="badge-criteria">
            <strong>Requirements:</strong>
            <p>{badge.criteria}</p>
          </div>
        )}

        {/* Progress Section */}
        {!isUnlocked && progressMax > 0 && (
          <div className="progress-section">
            <div className="progress-header">
              <span className="progress-label">Progress</span>
              <span className="progress-value">{progress}/{progressMax}</span>
            </div>
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${progressPercent}%` }}
              />
              <div className="progress-bar-animation" />
            </div>
            <div className="progress-percent">{Math.round(progressPercent)}%</div>

            {/* Next Milestone */}
            {nextMilestone && daysUntilMilestone !== null && (
              <div className="next-milestone">
                <span className="milestone-label">Next Milestone:</span>
                <span className="milestone-value">
                  {daysUntilMilestone === 0 ? 'Ready!' : `${daysUntilMilestone} remaining`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Earned Date */}
        {earned && earnedDate && (
          <div className="earned-date">
            🎉 Unlocked {new Date(earnedDate).toLocaleDateString()}
          </div>
        )}

        {/* Completed Indicator */}
        {isUnlocked && !earned && (
          <div className="ready-to-claim">
            ✨ Ready to Claim!
          </div>
        )}
      </div>

      {/* Badge Effect - Shimmer on earned */}
      {earned && <div className="badge-shimmer" />}
    </div>
  );
};

export default BadgeCard;
