import { useParams, useNavigate } from 'react-router-dom';
import { useProfileByAddress } from '../hooks/useProfile';
import ProfileCard from '../components/ProfileCard';
import './ProfileView.css';

export default function ProfileView() {
  const { address } = useParams();
  const navigate = useNavigate();
  const { profile, loading } = useProfileByAddress(address);

  if (!address) {
    return (
      <div className="profile-view-page">
        <div className="error-container">
          <h2>Invalid Profile</h2>
          <button onClick={() => navigate('/')} className="back-btn-primary">
            ← Back to Portfolio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-view-page">
      <div className="profile-view-container">
        <button onClick={() => navigate('/')} className="back-btn-primary">
          ← Back to Portfolio
        </button>

        <div className="profile-view-content">
          {loading ? (
            <div className="loading-state">Loading profile...</div>
          ) : profile ? (
            <>
              <ProfileCard address={address} />
              <div className="profile-view-details">
                <h2>Profile Information</h2>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Address</span>
                    <code className="detail-value">{address}</code>
                  </div>
                  
                  {profile.createdAt && (
                    <div className="detail-item">
                      <span className="detail-label">Profile Created</span>
                      <span className="detail-value">
                        {new Date(profile.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  
                  {profile.updatedAt && (
                    <div className="detail-item">
                      <span className="detail-label">Last Updated</span>
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
              <h2>No Profile Found</h2>
              <p>This address doesn't have a profile yet.</p>
              <button onClick={() => navigate('/')} className="back-btn-primary">
                ← Back to Portfolio
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
