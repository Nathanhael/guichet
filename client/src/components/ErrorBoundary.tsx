import React, { ErrorInfo, ReactNode } from 'react';

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
                <div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg-base)] text-[var(--color-text-primary)] p-6">
                    <h1 className="text-2xl font-mono font-bold uppercase tracking-tight mb-4 text-[var(--color-accent-red)]">Component failed to load</h1>
                    {isDev && this.state.error && (
                        <div className="w-full max-w-3xl bg-[var(--color-bg-elevated)] border-2 border-[var(--color-accent-red)] p-4 overflow-auto">
                            <p className="font-mono font-bold text-sm mb-2">{this.state.error.toString()}</p>
                            <pre className="font-mono text-[10px] text-[var(--color-text-muted)] whitespace-pre-wrap">{this.state.errorInfo?.componentStack || this.state.error.stack}</pre>
                        </div>
                    )}
                    <button
                        onClick={() => window.location.reload()}
                        className="btn-primary mt-6"
                    >
                        Try again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
