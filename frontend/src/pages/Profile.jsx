import { useState, useEffect, useRef } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../hooks/useProfile';
import { normalizeAddress } from '../services/profileService';
import { getStoredLanguagePreference, t } from '../utils/language';
import './Profile.css';

export default function Profile() {
  const { account, connected } = useWallet();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const address = normalizeAddress(account?.address);
  const { profile, loading, saving, updateProfile, uploadProfilePicture, error } = useProfile(address);
  
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [pfp, setPfp] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [language, setLanguage] = useState(() => getStoredLanguagePreference());

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
      setUsername(profile.username || '');
      setBio(profile.bio || '');
      setTwitter(profile.twitter || '');
      setTelegram(profile.telegram || '');
      setPfp(profile.pfp || null);
    }
  }, [profile]);

  // Redirect if not connected
  useEffect(() => {
    if (!connected) {
      navigate('/');
    }
  }, [connected, navigate]);

  const formatAddress = (addr) => {
    if (!addr) return '';
    const str = String(addr);
    return `${str.slice(0, 6)}...${str.slice(-4)}`;
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    setImageError(null);

    try {
      const compressedImage = await uploadProfilePicture(file);
      setPfp(compressedImage);
      setImageError(null);
    } catch (err) {
      setImageError(err.message);
      console.error('Error uploading image:', err);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleRemoveImage = async () => {
    setPfp(null);
    setImageError(null);
  };

  const handleSave = async () => {
    if (!address) return;

    try {
      await updateProfile({
        username,
        bio,
        twitter,
        telegram,
        pfp,
      });
      
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error('Error saving profile:', err);
      alert(t(language, 'profileSaveFailed') + err.message);
    }
  };

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-container">
          <div className="loading-state">Loading profile...</div>
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
          <div className="profile-avatar-section">
            <div className="profile-avatar">
              <img 
                src={pfp || '/pfp.PNG'} 
                alt="Profile" 
                className="avatar-image" 
              />
              {uploadingImage && (
                <div className="avatar-loading">
                  <div className="spinner"></div>
                </div>
              )}
            </div>
            
            <div className="avatar-actions">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageUpload}
                accept="image/*"
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="upload-btn"
                disabled={uploadingImage}
              >
                {pfp ? t(language, 'profileChangePhoto') : t(language, 'profileUploadPhoto')}
              </button>
              {pfp && (
                <button
                  onClick={handleRemoveImage}
                  className="remove-btn"
                  disabled={uploadingImage}
                >
                  {t(language, 'profileRemovePhoto')}
                </button>
              )}
            </div>
            
            {imageError && (
              <div className="image-error">{imageError}</div>
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
              disabled={saving || uploadingImage}
            >
              {saving ? t(language, 'profileSaving') : t(language, 'profileSave')}
            </button>
            <button className="statement-btn" type="button">
              {t(language, 'profileDownloadStatement')}
            </button>
          </div>
          
          {error && (
            <div className="error-message">{error}</div>
          )}
        </div>

        <div className="profile-stats">
          <div className="stat-card">
            <span className="stat-label">{t(language, 'profileProfileCreated')}</span>
            <span className="stat-value">
              {profile?.createdAt
                ? new Date(profile.createdAt).toLocaleDateString()
                : 'Today'}
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
