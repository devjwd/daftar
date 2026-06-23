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

import { t } from '../../utils/language';

import { Profile } from '@daftar/types';

interface ProfileModalProps {
  viewingAddress: string | null;
  canEditProfile: boolean;
  language: string;
  onClose: () => void;
  preloadedProfile?: Profile | null;

  preloadedAvatarSrc?: string;
}

const ProfileModal: React.FC<ProfileModalProps> = ({
  viewingAddress,
  canEditProfile,
  language,
  onClose,
  preloadedProfile,

  preloadedAvatarSrc,
}) => {
  const navigate = useNavigate();

  const { profile: hookProfile } = useProfile(viewingAddress);
  const userProfile = hookProfile || preloadedProfile;

  const modalAvatarSrc = userProfile?.avatar_url || preloadedAvatarSrc || '/logo.png';

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
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
