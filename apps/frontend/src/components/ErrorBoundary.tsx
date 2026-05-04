import React, { Component, ErrorInfo, ReactNode } from 'react';
import AppErrorView from './AppErrorView';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <AppErrorView 
          title="Unexpected Error"
          message={this.state.error?.message || "Something went wrong in the application."}
          onRetry={() => window.location.reload()}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
