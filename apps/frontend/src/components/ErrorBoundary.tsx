import React, { Component, ErrorInfo, ReactNode } from 'react';
import AppErrorView from './AppErrorView';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isAssetError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    isAssetError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    // Detect Vite asset loading errors (common after new deployments)
    const errorMessage = error.message.toLowerCase();
    const isAssetError = 
      errorMessage.includes('preload') || 
      errorMessage.includes('css') || 
      errorMessage.includes('dynamically imported module') ||
      errorMessage.includes('fetch');
      
    return { 
      hasError: true, 
      error,
      isAssetError
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleRetry = () => {
    // If it's an asset error, we want a hard reload to bypass cache and get the new index.html
    if (this.state.isAssetError) {
      window.location.assign(window.location.origin + window.location.pathname + window.location.search);
    } else {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      const isAssetError = this.state.isAssetError;
      
      return (
        <AppErrorView 
          title={isAssetError ? "Update Available" : "Unexpected Error"}
          message={isAssetError 
            ? "A new version of DAFTAR is available. Please click below to refresh the application." 
            : (this.state.error?.message || "Something went wrong in the application.")
          }
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
