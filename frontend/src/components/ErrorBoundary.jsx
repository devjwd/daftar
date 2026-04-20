import React from "react";
import AppErrorView from "./AppErrorView";

const CHUNK_RELOAD_KEY = "daftar_chunk_reload_attempted";

const isChunkLoadError = (error) => {
  const message = String(error?.message || error || "");
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Failed to load module script") ||
    message.includes("ChunkLoadError")
  );
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  componentDidMount() {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      // Ignore sessionStorage access failures.
    }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);

    if (!isChunkLoadError(error)) {
      return;
    }

    try {
      const alreadyRetried = sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1";
      if (!alreadyRetried) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      // DEBUG: show raw error instead of branded 500 page
      const msg = this.state.error?.message || String(this.state.error);
      const stack = this.state.error?.stack || '';
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', background: '#0a0a0a', color: '#f87171', minHeight: '100vh' }}>
          <h2 style={{ color: '#fbbf24' }}>Runtime Error (debug mode)</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#1a0000', padding: '1rem', borderRadius: '8px' }}>
            {msg}{'\n\n'}{stack}
          </pre>
          <button
            style={{ marginTop: '1rem', padding: '0.5rem 1.2rem', background: '#fbbf24', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

