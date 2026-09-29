import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the route) clears a caught error. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence for render errors (e.g. a malformed flight from an old backup):
 * shows a friendly screen instead of a blank page. Resets when `resetKey` changes.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" role="alert">
        <Icon name="warning" size={32} />
        <h1 className="empty__title">Something went wrong</h1>
        <p>This screen hit an unexpected problem. Your flights are safe — they’re stored on this device and weren’t changed.</p>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

/** ErrorBoundary that resets whenever the route changes. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
