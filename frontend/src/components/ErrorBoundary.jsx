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
      return (
        <AppErrorView
          code="500"
          title="Page Temporarily Unavailable"
          message="Something broke while loading this view. Refresh the page and try again in a moment."
          onRetry={() => {
            try {
              sessionStorage.removeItem(CHUNK_RELOAD_KEY);
            } catch {
              // Ignore sessionStorage access failures.
            }
            this.setState({ hasError: false, error: null });
            window.location.reload();
          }}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

