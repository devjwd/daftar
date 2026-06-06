/**
 * ProfileModal — User profile popup overlay
 * 
 * Extracted from Dashboard.tsx. Shows avatar, username, address,
 * level/XP progress, and collected badges in a modal overlay.
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useProfile } from '../../hooks/useProfile';
import { useUserLevel } from '../../hooks/useUserLevel';
import { useBadges } from '../../hooks/useBadges';
import useUserBadges from '../../hooks/useUserBadges';
import { useMovementClient } from '../../hooks/useMovementClient';
import { DEFAULT_NETWORK } from '../../config/network';
import { getLevelBasedPfp } from '../../utils/levelPfp';
import { t } from '../../utils/language';

import { Profile } from '@daftar/types';

interface ProfileModalProps {
  viewingAddress: string | null;
  canEditProfile: boolean;
  language: string;
  onClose: () => void;
  preloadedProfile?: Profile | null;
  preloadedLevel?: number;
  preloadedXp?: number;
  preloadedNextLevelXP?: number;
  preloadedXpProgress?: number;
  preloadedBadges?: any[];
  preloadedAvatarSrc?: string;
}

const ProfileModal: React.FC<ProfileModalProps> = ({
  viewingAddress,
  canEditProfile,
  language,
  onClose,
  preloadedProfile,
  preloadedLevel,
  preloadedXp,
  preloadedNextLevelXP,
  preloadedXpProgress,
  preloadedBadges,
  preloadedAvatarSrc,
}) => {
  const navigate = useNavigate();

  const { profile: hookProfile } = useProfile(viewingAddress);
  const { level: hookLevel, xp: hookXp, nextLevelXP: hookNextLevelXP, xpProgress: hookXpProgress, badges: hookBadges, loading: levelLoading } = useUserLevel(viewingAddress);

  const userProfile = hookProfile || preloadedProfile;
  const level = levelLoading ? (preloadedLevel ?? hookLevel) : hookLevel;
  const xp = levelLoading ? (preloadedXp ?? hookXp) : hookXp;
  const nextLevelXP = levelLoading ? (preloadedNextLevelXP ?? hookNextLevelXP) : hookNextLevelXP;
  const xpProgress = levelLoading ? (preloadedXpProgress ?? hookXpProgress) : hookXpProgress;
  const userBadges = levelLoading ? (preloadedBadges ?? hookBadges) : hookBadges;

  const isLevelLoading = levelLoading && preloadedLevel === undefined;

  const currentNetwork = DEFAULT_NETWORK;
  const { client: movementClient, loading: movementClientLoading } = useMovementClient(currentNetwork.rpc);

  const { badges: onchainBadges, loading: onchainBadgesLoading } = useBadges(viewingAddress, {
    client: movementClient,
    clientLoading: movementClientLoading,
    enablePolling: false,
  });
  const { earnedBadges: persistedBadges } = useUserBadges(viewingAddress);

  const modalAvatarSrc = (hookProfile || !preloadedAvatarSrc)
    ? getLevelBasedPfp({
        level,
        address: viewingAddress,
        preferredPfp: userProfile?.avatar_url,
      })
    : preloadedAvatarSrc;

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close modal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="profile-modal-content">
          <div className="profile-modal-main">
            <div className="modal-avatar-section">
              <img
                src={modalAvatarSrc}
                alt="User"
                className="modal-avatar-image"
              />
            </div>
            <div className="modal-info-section">
              <h2 className="modal-username">{userProfile?.username || t(language, 'dashAnonymousUser')}</h2>
              <div className="modal-address">
                {viewingAddress && (
                  <>
                    <span>{viewingAddress.slice(0, 6)}...{viewingAddress.slice(-4)}</span>
                    <button
                      className="modal-copy-btn"
                      onClick={(e) => {
                        navigator.clipboard.writeText(viewingAddress);
                        const btn = e.currentTarget;
                        btn.classList.add('copied');
                        setTimeout(() => btn.classList.remove('copied'), 1000);
                      }}
                      title="Copy address"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="modal-copy-icon-svg">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  </>
                )}
              </div>
              {userProfile?.bio && (
                <p className="modal-bio">{userProfile.bio}</p>
              )}
              {canEditProfile && (
                <button
                  className="modal-edit-btn"
                  onClick={() => {
                    onClose();
                    navigate('/profile');
                  }}
                >
                  {t(language, 'dashEditProfile')}
                </button>
              )}
            </div>
            {!isLevelLoading && (
              <div className="modal-level-section">
                <div className="modal-level-row">
                  <span className="modal-level-label">{t(language, 'dashCurrentLevel')}</span>
                  <span className="modal-level-value">{level}</span>
                </div>
                <div className="modal-xp-row">
                  <span className="modal-xp-label">{t(language, 'dashExpPoints')}</span>
                  <span className="modal-xp-value">{xp} / {nextLevelXP}</span>
                </div>
                <div className="modal-xp-bar-container">
                  <div className="modal-xp-bar-fill" style={{ width: `${xpProgress}%` }} />
                </div>
              </div>
            )}
          </div>
          <div className="modal-badges-section">
            <h3 className="modal-badges-title">{t(language, 'dashCollectedBadges')} ({userBadges.length})</h3>
            <div className="modal-onchain-badges">
              {onchainBadgesLoading ? (
                <div className="modal-onchain-loading">{t(language, 'dashLoadingBadges')}</div>
              ) : onchainBadges && onchainBadges.filter(b => b.earned).length > 0 && (
                <div className="modal-onchain-badges-grid">
                  {onchainBadges.filter(b => b.earned).map((b) => (
                    <div key={b.id} className="modal-onchain-badge owned" title={b.name}>
                      <div className="modal-onchain-badge-icon">
                        {b.imageUrl ? (
                          <img src={b.imageUrl} alt={b.name} onError={(e) => { (e.target as HTMLElement).style.display = 'none' }} />
                        ) : (
                          <span className="badge-fallback-letter">{b.name ? b.name[0] : 'B'}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {((persistedBadges && persistedBadges.length > 0 ? persistedBadges : userBadges).filter(b => b.earned !== false).length > 0) ? (
              <div className="modal-badges-grid">
                {(persistedBadges && persistedBadges.length > 0 ? persistedBadges : userBadges)
                  .filter(b => b.earned !== false)
                  .map(badge => (
                    <div key={badge.id} className="modal-badge-item collection-style" title={`${badge.name}: ${badge.description}`}>
                      <div className="modal-badge-icon-box">
                        <span className="modal-badge-icon">{badge.icon || 'Badge'}</span>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="modal-no-badges-card">
                <div className="modal-no-badges-icon-wrapper">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <circle cx="12" cy="11" r="3" />
                    <line x1="12" y1="14" x2="12" y2="17" />
                  </svg>
                </div>
                <p className="modal-no-badges-text">{t(language, 'dashNoBadgesEarned')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
