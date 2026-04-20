import React, { ErrorInfo, ReactNode } from 'react';
import Button from './ui/Button';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        this.setState({ error, errorInfo });
    }

    render() {
        if (this.state.hasError) {
            const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            return (
                <div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg-base)] text-[var(--color-ink)] p-6">
                    <div className="w-14 h-14 rounded-full bg-[var(--color-urgent-soft)] flex items-center justify-center mb-5">
                        <span className="text-2xl text-[var(--color-urgent)]">!</span>
                    </div>
                    <h1 className="text-[22px] font-semibold tracking-[-0.2px] mb-4">Component failed to load</h1>
                    {isDev && this.state.error && (
                        <div className="w-full max-w-3xl rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] p-4 overflow-auto">
                            <p className="font-mono text-[12px] font-semibold text-[var(--color-urgent)] mb-2">{this.state.error.toString()}</p>
                            <pre className="font-mono text-[11px] text-[var(--color-ink-muted)] whitespace-pre-wrap leading-relaxed">{this.state.errorInfo?.componentStack || this.state.error.stack}</pre>
                        </div>
                    )}
                    <Button variant="primary" size="md" className="mt-6" onClick={() => window.location.reload()}>
                        Try again
                    </Button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
