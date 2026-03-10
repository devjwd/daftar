/**
 * BadgeCard Component
 * 
 * Displays a single SBT badge with rarity styling, progress tracking,
 * criteria breakdown, and earned/eligible/locked states.
 */
import React, { useMemo } from 'react';
import { getRarityInfo, CRITERIA_LABELS } from '../config/badges.js';
import './BadgeCard.css';

const BadgeCard = ({
  badge,
  earned = false,
  earnedDate = null,
  eligible = false,
  progress = 0,
  criteriaResults = [],
  onMint = null,
  minting = false,
  onClick = null,
  compact = false,
}) => {
  const rarity = useMemo(() => getRarityInfo(badge.rarity || 'COMMON'), [badge.rarity]);

  const progressClamped = Math.min(100, Math.max(0, progress));
  const locked = !earned && !eligible;

  return (
    <div
      className={`bc-card ${earned ? 'bc-earned' : eligible ? 'bc-eligible' : 'bc-locked'} bc-rarity-${(badge.rarity || 'COMMON').toLowerCase()}`}
      style={{
        '--rc': rarity.color,
        '--rb': rarity.borderColor,
        '--rg': rarity.glowColor,
        '--rbg': rarity.bgGradient,
      }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* Glow layer for earned badges */}
      {earned && <div className="bc-glow" />}

      {/* Status indicator */}
      {earned && <div className="bc-status bc-status-earned">Earned</div>}
      {eligible && !earned && <div className="bc-status bc-status-eligible">Eligible</div>}

      {/* Badge Image */}
      <div className="bc-image-wrap">
        {badge.imageUrl ? (
          <img
            src={badge.imageUrl}
            alt={badge.name}
            className="bc-image"
            loading="lazy"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <div className="bc-image-fallback" style={{ display: badge.imageUrl ? 'none' : 'flex' }}>
          {badge.emoji || (badge.category === 'activity' ? '⚡' : badge.category === 'longevity' ? '🕐' : '🏆')}
        </div>

        {/* Rarity pill */}
        <span className="bc-rarity-pill" style={{ background: rarity.color }}>
          {rarity.name}
        </span>

        {/* XP pill */}
        {badge.xp > 0 && (
          <span className="bc-xp-pill">+{badge.xp} XP</span>
        )}
      </div>

      {/* Content */}
      <div className="bc-content">
        <h3 className="bc-name">{badge.name}</h3>
        {!compact && <p className="bc-desc">{badge.description}</p>}

        {/* Criteria breakdown */}
        {!compact && criteriaResults.length > 0 && (
          <div className="bc-criteria-list">
            {criteriaResults.map((cr, i) => (
              <div key={i} className={`bc-criterion ${cr.eligible ? 'bc-criterion-met' : 'bc-criterion-unmet'}`}>
                <span className="bc-criterion-icon">{cr.eligible ? '✓' : '○'}</span>
                <span className="bc-criterion-label">{CRITERIA_LABELS[cr.type] || cr.type}</span>
                <span className="bc-criterion-value">{cr.label || `${cr.current}/${cr.required}`}</span>
              </div>
            ))}
          </div>
        )}

        {/* Progress bar (for non-earned badges) */}
        {!earned && progressClamped > 0 && progressClamped < 100 && !compact && (
          <div className="bc-progress-section">
            <div className="bc-progress-header">
              <span className="bc-progress-label">Progress</span>
              <span className="bc-progress-pct">{Math.round(progressClamped)}%</span>
            </div>
            <div className="bc-progress-track">
              <div className="bc-progress-fill" style={{ width: `${progressClamped}%` }}>
                <div className="bc-progress-shimmer" />
              </div>
            </div>
          </div>
        )}

        {/* Earned date */}
        {earned && earnedDate && (
          <div className="bc-earned-date">
            Unlocked {new Date(earnedDate).toLocaleDateString()}
          </div>
        )}

        {/* Mint button */}
        {eligible && !earned && onMint && (
          <button
            className="bc-mint-btn"
            onClick={(e) => { e.stopPropagation(); onMint(badge); }}
            disabled={minting}
          >
            {minting ? 'Minting...' : 'Claim Badge'}
          </button>
        )}

        {/* Locked state */}
        {locked && !compact && (
          <div className="bc-locked-label">
            <span className="bc-lock-icon">🔒</span>
            Complete criteria to unlock
          </div>
        )}
      </div>

      {/* Shimmer animation for earned */}
      {earned && <div className="bc-shimmer" />}
    </div>
  );
};

export default BadgeCard;
