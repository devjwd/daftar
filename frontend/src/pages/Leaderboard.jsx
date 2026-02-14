import './Leaderboard.css';

export default function Leaderboard() {
  return (
    <div className="leaderboard-page">
      <div className="leaderboard-container">
        <div className="leaderboard-header">
          <h1>Leaderboard</h1>
        </div>

        <div className="leaderboard-empty">
          <p className="empty-message">No leaderboard available yet</p>
        </div>
      </div>
    </div>
  );
}
