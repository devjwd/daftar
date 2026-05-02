import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      whileHover={{ 
        scale: 1.02, 
        y: -5,
        transition: { duration: 0.2 }
      }}
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
      {/* Glow layer for earned or eligible badges */}
      {(earned || eligible) && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ 
            opacity: [0.3, 0.6, 0.3],
            scale: [1, 1.05, 1]
          }}
          transition={{ 
            duration: 3, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }}
          className="bc-glow" 
        />
      )}

      {/* Status indicator */}
      <AnimatePresence>
        {earned && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bc-status bc-status-earned"
          >
            Earned
          </motion.div>
        )}
        {eligible && !earned && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bc-status bc-status-eligible"
          >
            Eligible
          </motion.div>
        )}
      </AnimatePresence>

      {/* Badge Image */}
      <div className="bc-image-wrap">
        {badge.imageUrl ? (
          <motion.img
            layoutId={`badge-img-${badge.id}`}
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
              <motion.div 
                key={i} 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className={`bc-criterion ${cr.eligible ? 'bc-criterion-met' : 'bc-criterion-unmet'}`}
              >
                <span className="bc-criterion-icon">{cr.eligible ? '✓' : '○'}</span>
                <span className="bc-criterion-label">{CRITERIA_LABELS[cr.type] || cr.type}</span>
                <span className="bc-criterion-value">{cr.label || `${cr.current}/${cr.required}`}</span>
              </motion.div>
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
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${progressClamped}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className="bc-progress-fill"
              >
                <div className="bc-progress-shimmer" />
              </motion.div>
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
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="bc-mint-btn"
            onClick={(e) => { e.stopPropagation(); onMint(badge); }}
            disabled={minting}
          >
            {minting ? 'Minting...' : 'Claim Badge'}
          </motion.button>
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
    </motion.div>
  );
};

export default BadgeCard;

export default BadgeCard;
