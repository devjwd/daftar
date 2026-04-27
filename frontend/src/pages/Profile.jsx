import { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../hooks/useProfile';
import { useUserLevel } from '../hooks/useUserLevel';
import { normalizeAddress } from '../services/profileService';
import { getAllLevelPfps, getLevelBasedPfp, isPfpUnlockedForLevel } from '../utils/levelPfp';
import { getStoredLanguagePreference, t } from '../utils/language';
import './Profile.css';

export default function Profile() {
  const { account, connected, signMessage } = useWallet();
  const navigate = useNavigate();

  const address = normalizeAddress(account?.address);
  const { profile, loading, saving, updateProfile, error } = useProfile(address, {
    account,
    connected,
    signMessage,
  });
  const { level } = useUserLevel(address);

  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [showPfpPicker, setShowPfpPicker] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [notice, setNotice] = useState({ type: '', message: '' });
  const [language, setLanguage] = useState(() => getStoredLanguagePreference());
  const pfpPickerRef = useRef(null);

  const allPfps = useMemo(() => getAllLevelPfps(), []);
  const activeAvatarSrc = useMemo(
    () => getLevelBasedPfp({ level, address, preferredPfp: avatarUrl }),
    [level, address, avatarUrl]
  );

  useEffect(() => {
    const syncLanguage = () => setLanguage(getStoredLanguagePreference());
    const onLanguageChange = (event) => {
      if (event?.detail?.language) {
        setLanguage(event.detail.language);
      } else {
        syncLanguage();
      }
    };

    window.addEventListener('languagechange', onLanguageChange);
    window.addEventListener('storage', syncLanguage);
    return () => {
      window.removeEventListener('languagechange', onLanguageChange);
      window.removeEventListener('storage', syncLanguage);
    };
  }, []);

  // Load profile data when it changes
  useEffect(() => {
    if (profile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsername(profile.username || '');
      setBio(profile.bio || '');
      setTwitter(profile.twitter || '');
      setTelegram(profile.telegram || '');
      setAvatarUrl(
        getLevelBasedPfp({
          level,
          address,
          preferredPfp: typeof (profile.avatar_url || profile.pfp) === 'string' ? (profile.avatar_url || profile.pfp) : null,
        })
      );
    }
  }, [profile, level, address]);

  // Redirect if not connected
  useEffect(() => {
    if (!connected) {
      navigate('/');
    }
  }, [connected, navigate]);

  useEffect(() => {
    if (!showPfpPicker) return undefined;

    const onPointerDown = (event) => {
      if (!pfpPickerRef.current?.contains(event.target)) {
        setShowPfpPicker(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showPfpPicker]);

  const formatAddress = (addr) => {
    if (!addr) return '';
    const str = String(addr);
    return `${str.slice(0, 6)}...${str.slice(-4)}`;
  };

  const handleSave = async () => {
    if (!address) return;

    try {
      setNotice({ type: '', message: '' });
      await updateProfile({
        username,
        bio,
        twitter,
        telegram,
        avatar_url: activeAvatarSrc,
      });

      setShowSuccess(true);

      // Trigger auto-award check in background (check for Profile Complete etc)
      import('../services/badges/AutoAwardService.js').then(module => {
        module.checkAndAwardBadges(address, { triggeredBy: 'profile_update' });
      }).catch(err => console.warn('AutoAward trigger failed:', err));

      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error('Error saving profile:', err);
      setNotice({
        type: 'error',
        message: t(language, 'profileSaveFailed') + String(err?.message || 'unknown error'),
      });
    }
  };

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-container">
          <div className="loading-state">{t(language, 'profileLoading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      {showSuccess && (
        <div className="success-banner">
          {t(language, 'profileSavedSuccess')}
        </div>
      )}

      <div className="profile-container">
        <div className="profile-header">
          <div className="profile-avatar-section" ref={pfpPickerRef}>
            <button
              type="button"
              className="profile-avatar profile-avatar-button"
              onClick={() => setShowPfpPicker(true)}
              aria-label="Open profile picture picker"
            >
              <img
                src={activeAvatarSrc}
                alt="Profile"
                className="avatar-image"
              />
            </button>
            <p className="level-avatar-hint">{t(language, 'profilePfpHint', { level })}</p>

            {showPfpPicker && (
              <div className="pfp-picker-popover">
                <div className="pfp-picker-header">
                  <h3>{t(language, 'profileSelectPfp')}</h3>
                  <button
                    type="button"
                    className="pfp-picker-close"
                    onClick={() => setShowPfpPicker(false)}
                    aria-label="Close profile picture picker"
                  >
                    ×
                  </button>
                </div>
                <div className="level-avatar-grid">
                  {allPfps.map((option) => {
                    const unlocked = isPfpUnlockedForLevel(option.src, level);
                    const selected = option.src === activeAvatarSrc;

                    return (
                      <button
                        key={option.src}
                        type="button"
                        className={`level-avatar-option ${selected ? 'selected' : ''} ${unlocked ? '' : 'locked'}`}
                        onClick={() => {
                          if (!unlocked) return;
                          setAvatarUrl(option.src);
                          setShowPfpPicker(false);
                        }}
                        aria-label={
                          unlocked
                            ? `Select level ${option.requiredLevel} avatar`
                            : `Locked level ${option.requiredLevel} avatar`
                        }
                        disabled={!unlocked}
                      >
                        <img src={option.src} alt={`Level ${option.requiredLevel} avatar`} />
                        {!unlocked && <span className="avatar-lock">🔒</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <h1>{t(language, 'profileTitle')}</h1>
          <p className="profile-address">{formatAddress(address)}</p>
        </div>

        <div className="profile-form">
          <div className="form-section">
            <h2 className="section-title">{t(language, 'profileBasicInfo')}</h2>

            <div className="form-group">
              <label>{t(language, 'profileDisplayName')}</label>
              <input
                type="text"
                placeholder={t(language, 'profileDisplayNamePlaceholder')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="form-input"
                maxLength={50}
              />
              <span className="char-count">{username.length}/50</span>
            </div>

            <div className="form-group">
              <label>{t(language, 'profileBio')}</label>
              <textarea
                placeholder={t(language, 'profileBioPlaceholder')}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="form-textarea"
                rows={4}
                maxLength={500}
              />
              <span className="char-count">{bio.length}/500</span>
            </div>
          </div>

          <div className="form-section">
            <h2 className="section-title">{t(language, 'profileSocialLinks')}</h2>

            <div className="form-group">
              <label>
                <span className="social-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: 'middle', marginTop: '-2px' }}>
                    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zm-1.292 19.49h2.039L6.486 3.24H4.298l13.311 17.403z" />
                  </svg>
                </span> Twitter/X
              </label>
              <input
                type="text"
                placeholder="@username"
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                className="form-input"
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="social-icon" style={{ display: 'inline-block', marginRight: '8px', verticalAlign: 'middle' }}>
                  <path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3"></path>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
                Link
              </label>
              <input
                type="text"
                placeholder="https://website.com"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                className="form-input"
                maxLength={200}
              />
            </div>
          </div>

          <div className="profile-actions">
            <button
              onClick={handleSave}
              className="save-btn"
              disabled={saving}
            >
              {saving ? t(language, 'profileSaving') : t(language, 'profileSave')}
            </button>
          </div>

          <p className="profile-migration-note">
            {t(language, 'profileMigrationNote')}
          </p>

          {error && (
            <div className="error-message">{error}</div>
          )}

          {notice.message && (
            <div className={notice.type === 'error' ? 'error-message' : 'success-inline-message'}>{notice.message}</div>
          )}
        </div>

        <div className="profile-stats">
          <div className="stat-card">
            <span className="stat-label">{t(language, 'profileProfileCreated')}</span>
            <span className="stat-value">
              {profile?.createdAt
                ? new Date(profile.createdAt).toLocaleDateString()
                : t(language, 'profileToday')}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t(language, 'profileLastUpdated')}</span>
            <span className="stat-value">
              {profile?.updatedAt
                ? new Date(profile.updatedAt).toLocaleDateString()
                : '-'}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">{t(language, 'profileProfileViews')}</span>
            <span className="stat-value">{t(language, 'profileComingSoon')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
