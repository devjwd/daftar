import { useEffect, useState } from 'react';
import { getLevelFromXP } from '../config/badges';
import { getStoredLanguagePreference, t } from '../utils/language';
import './Leaderboard.css';

const REFRESH_INTERVAL_MS = 60_000;

const devLog = (...args) => {
  if (import.meta.env.DEV) console.log(...args);
};

const truncateAddress = (value) => {
  const address = String(value || '').trim();
  if (address.length <= 12) return address || 'Unknown';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const normalizeEntries = (payload) => {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.leaderboard)
      ? payload.leaderboard
      : [];

  return rows.map((row, index) => {
    const xp = Number(row?.xp || 0);

    return {
      rank: Number(row?.rank || index + 1),
      walletAddress: String(row?.wallet_address || row?.address || '').trim(),
      username: String(row?.username || '').trim(),
      xp,
      level: getLevelFromXP(xp),
    };
  });
};

function LeaderboardSkeleton() {
  return (
    <div className="leaderboard-table leaderboard-table--loading" aria-hidden="true">
      <div className="leaderboard-header-row">
        <span>{t(getStoredLanguagePreference(), 'leaderRank')}</span>
        <span>{t(getStoredLanguagePreference(), 'leaderUser')}</span>
        <span>{t(getStoredLanguagePreference(), 'leaderAddress')}</span>
        <span>{t(getStoredLanguagePreference(), 'leaderXP')}</span>
        <span>{t(getStoredLanguagePreference(), 'leaderLevel')}</span>
      </div>

      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="leaderboard-row leaderboard-row--skeleton">
          <span className="leaderboard-skeleton leaderboard-skeleton--rank" />
          <span className="leaderboard-skeleton leaderboard-skeleton--user" />
          <span className="leaderboard-skeleton leaderboard-skeleton--address" />
          <span className="leaderboard-skeleton leaderboard-skeleton--xp" />
          <span className="leaderboard-skeleton leaderboard-skeleton--level" />
        </div>
      ))}
    </div>
  );
}

export default function Leaderboard() {
  const [language, setLanguage] = useState(() => getStoredLanguagePreference());
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  useEffect(() => {
    let active = true;
    let currentController = null;

    const loadLeaderboard = async () => {
      if (active) {
        setLoading(true);
        setError('');
      }

      currentController?.abort();
      currentController = new AbortController();

      try {
        const response = await fetch('/api/leaderboard', {
          method: 'GET',
          signal: currentController.signal,
        });

        if (!response.ok) {
          throw new Error(`Leaderboard request failed (${response.status})`);
        }

        const payload = await response.json();
        if (!active) return;

        setEntries(normalizeEntries(payload));
      } catch (fetchError) {
        if (fetchError?.name === 'AbortError') {
          return;
        }

        devLog('[leaderboard] failed to load leaderboard', fetchError);
        if (!active) return;

        setEntries([]);
        setError(t(language, 'leaderError'));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadLeaderboard();

    const intervalId = window.setInterval(() => {
      void loadLeaderboard();
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      currentController?.abort();
    };
  }, []);

  return (
    <div className="leaderboard-page">
      <div className="leaderboard-container">
        <div className="leaderboard-header">
          <h1>{t(language, 'leaderboardTitle')}</h1>
        </div>

        {loading ? <LeaderboardSkeleton /> : null}

        {!loading && error ? (
          <div className="leaderboard-empty">
            <p className="empty-message">{error}</p>
          </div>
        ) : null}

        {!loading && !error && entries.length === 0 ? (
          <div className="leaderboard-empty">
            <p className="empty-message">{t(language, 'leaderboardEmpty')}</p>
          </div>
        ) : null}

        {!loading && !error && entries.length > 0 ? (
          <div className="leaderboard-table">
            <div className="leaderboard-header-row">
              <span>{t(language, 'leaderRank')}</span>
              <span>{t(language, 'leaderUser')}</span>
              <span>{t(language, 'leaderAddress')}</span>
              <span>{t(language, 'leaderXP')}</span>
              <span>{t(language, 'leaderLevel')}</span>
            </div>

            {entries.map((entry, index) => {
              const rank = index + 1;
              const topRankClass = rank <= 3 ? `rank-${rank}` : '';

              return (
                <div key={entry.walletAddress || `${rank}-${entry.username}`} className={`leaderboard-row ${topRankClass}`.trim()}>
                  <div className="col-rank">
                    <span className="rank-badge">#{rank}</span>
                  </div>

                  <div className="col-user">
                    <span className={`user-badge ${rank <= 3 ? `user-badge--${rank}` : ''}`.trim()} aria-hidden="true" />
                    <div className="leaderboard-user-meta">
                      <span className="username">{entry.username || t(language, 'leaderAnonymous')}</span>
                      <span className="leaderboard-user-subtitle">{entry.username ? t(language, 'leaderProfileSet') : t(language, 'leaderNoUsername')}</span>
                    </div>
                  </div>

                  <div className="col-address">
                    <span className="address">{truncateAddress(entry.walletAddress)}</span>
                  </div>

                  <div className="col-xp">
                    <span className="worth">{entry.xp.toLocaleString()}</span>
                  </div>

                  <div className="col-level">
                    <span className="leaderboard-level">{t(language, 'leaderLevel')} {entry.level}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
