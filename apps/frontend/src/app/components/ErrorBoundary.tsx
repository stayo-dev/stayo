import React from 'react';
import { PageError } from '@/shared/ui/error/PageError';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  context?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <PageError
          error={this.state.error ?? undefined}
          onRetry={this.handleRetry}
          retryLabel="Reload this section"
          className="min-h-[60vh]"
        />
      );
    }
    return this.props.children;
  }
}
