export default function LoadingScreen({
  label = "Loading portfolio",
  message = "Please wait a moment.",
}) {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label={label}>
      <div className="loading-screen__shell">
        <div className="loading-screen__mark" aria-hidden="true">
          <div className="loading-screen__logo-wrap">
            <img src="/daftar icon.png" alt="" className="loading-screen__logo" />
          </div>
        </div>

        <div className="loading-screen__copy">
          <h1>Daftar</h1>
          <p>{message}</p>
        </div>

        <div className="loading-screen__meter" aria-hidden="true">
          <span className="loading-screen__meter-bar" />
        </div>
      </div>
    </div>
  );
}