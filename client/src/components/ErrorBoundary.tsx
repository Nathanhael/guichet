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
            return (
                <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white p-6">
                    <h1 className="text-2xl font-black uppercase tracking-tighter mb-4 text-red-500">Component failed to load</h1>
                    {this.state.error && (
                        <div className="w-full max-w-3xl bg-black/5 dark:bg-white/5 border-2 border-red-500 p-4 overflow-auto custom-scrollbar">
                            <p className="font-bold text-sm mb-2">{this.state.error.toString()}</p>
                            <pre className="text-[10px] opacity-60 whitespace-pre-wrap">{this.state.errorInfo?.componentStack || this.state.error.stack}</pre>
                        </div>
                    )}
                    <button 
                        onClick={() => window.location.reload()}
                        className="mt-6 px-6 py-3 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all"
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
