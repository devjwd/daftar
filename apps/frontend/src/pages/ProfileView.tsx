import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProfileByAddress } from '../hooks/useProfile';
import ProfileCard from '../components/ProfileCard';
import { getStoredLanguagePreference, t } from '../utils/language';
import './ProfileView.css';

export default function ProfileView() {
  const { address } = useParams();
  const navigate = useNavigate();
  const { profile, loading } = useProfileByAddress(address);
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

  if (!address) {
    return (
      <div className="profile-view-page">
        <div className="error-container">
          <h2>{t(language, 'profileViewInvalid')}</h2>
          <button onClick={() => navigate('/')} className="back-btn-primary">
            ← {t(language, 'profileViewBackToPortfolio')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-view-page">
      <div className="profile-view-container">
        <button onClick={() => navigate('/')} className="back-btn-primary">
          ← {t(language, 'profileViewBackToPortfolio')}
        </button>

        <div className="profile-view-content">
          {loading ? (
            <div className="loading-state">{t(language, 'profileViewLoading')}</div>
          ) : profile ? (
            <>
              <ProfileCard address={address} />
              <div className="profile-view-details">
                <h2>{t(language, 'profileViewInfo')}</h2>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">{t(language, 'profileViewAddress')}</span>
                    <code className="detail-value">{address}</code>
                  </div>
                  
                  {profile.createdAt && (
                    <div className="detail-item">
                      <span className="detail-label">{t(language, 'profileProfileCreated')}</span>
                      <span className="detail-value">
                        {new Date(profile.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  
                  {profile.updatedAt && (
                    <div className="detail-item">
                      <span className="detail-label">{t(language, 'profileLastUpdated')}</span>
                      <span className="detail-value">
                        {new Date(profile.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="no-profile-container">
              <h2>{t(language, 'profileViewNoProfileTitle')}</h2>
              <p>{t(language, 'profileViewNoProfileBody')}</p>
              <button onClick={() => navigate('/')} className="back-btn-primary">
                ← {t(language, 'profileViewBackToPortfolio')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
