import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary] caught error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl flex flex-col items-center justify-center min-h-[100px] text-center">
                    <span className="text-xl mb-2">⚠️</span>
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">Component failed to load</p>
                    <button
                        onClick={() => this.setState({ hasError: false })}
                        className="mt-2 text-[10px] text-red-500 hover:underline"
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
