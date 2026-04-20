import { useNavigate } from 'react-router-dom';
import { useProfileByAddress } from '../hooks/useProfile';
import './ProfileCard.css';

export default function ProfileCard({ address }) {
  const navigate = useNavigate();
  const { profile, loading } = useProfileByAddress(address);

  if (loading) {
    return (
      <div className="profile-card skeleton">
        <div className="profile-card-header">
          <div className="profile-card-avatar skeleton-avatar"></div>
          <div className="skeleton-text">
            <div className="skeleton-line"></div>
            <div className="skeleton-line short"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const formatAddress = (addr) => {
    if (!addr) return '';
    const str = String(addr);
    return `${str.slice(0, 6)}...${str.slice(-4)}`;
  };

  return (
    <div 
      className="profile-card clickable" 
      onClick={() => navigate(`/profile/${address}`)}
      role="button"
      tabIndex={0}
      onKeyPress={(e) => e.key === 'Enter' && navigate(`/profile/${address}`)}
    >
      <div className="profile-card-header">
        <div className="profile-card-avatar">
          <img 
            src={profile.pfp || '/pfp.PNG'} 
            alt={profile.username || 'User'} 
            className="profile-card-image" 
          />
        </div>
        <div className="profile-card-info">
          <h3 className="profile-card-name">
            {profile.username || formatAddress(address)}
          </h3>
          <p className="profile-card-address">{formatAddress(address)}</p>
        </div>
      </div>

      <div className="profile-card-divider" />

      {profile.bio && (
        <p className="profile-card-bio">{profile.bio}</p>
      )}

      {(profile.twitter || profile.telegram) && (
        <div className="profile-card-socials">
          {profile.twitter && (
            <a
              href={`https://twitter.com/${profile.twitter.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              title="Twitter/X"
            >
              <span className="social-icon">𝕏</span>
            </a>
          )}
          {profile.telegram && (
            <a
              href={`https://t.me/${profile.telegram.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              title="Telegram"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="social-icon">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a11.955 11.955 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.153-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.36-1.37.2-.456-.134-.883-.414-1.289-.77-.147-.127-.336-.191-.52-.191-.055 0-.109.005-.163.013-.502.113-1.005.656-1.059 1.22 0 .57.38.85.583 1.027.378.338.884.592 1.297.637.502.038 1.091-.044 1.601-.135 1.027-.226 1.918-.779 2.425-1.779.29-.576.17-1.392.589-1.487z"/>
              </svg>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
