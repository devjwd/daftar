import { useEffect, useState } from 'react';
import { getStoredLanguagePreference, t } from '../utils/language';
import './Leaderboard.css';

export default function Leaderboard() {
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

  return (
    <div className="leaderboard-page">
      <div className="leaderboard-container">
        <div className="leaderboard-header">
          <h1>{t(language, 'leaderboardTitle')}</h1>
        </div>

        <div className="leaderboard-empty">
          <p className="empty-message">{t(language, 'leaderboardEmpty')}</p>
        </div>
      </div>
    </div>
  );
}
