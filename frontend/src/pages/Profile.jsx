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
                <span className="social-icon">𝕏</span> Twitter/X
              </label>
              <input
                type="text"
                placeholder="@username"
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="social-icon" style={{ display: 'inline-block', marginRight: '8px', verticalAlign: 'middle' }}>
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a11.955 11.955 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.153-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.36-1.37.2-.456-.134-.883-.414-1.289-.77-.147-.127-.336-.191-.52-.191-.055 0-.109.005-.163.013-.502.113-1.005.656-1.059 1.22 0 .57.38.85.583 1.027.378.338.884.592 1.297.637.502.038 1.091-.044 1.601-.135 1.027-.226 1.918-.779 2.425-1.779.29-.576.17-1.392.589-1.487z"/>
                </svg>
                Telegram
              </label>
              <input
                type="text"
                placeholder="@username"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                className="form-input"
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
