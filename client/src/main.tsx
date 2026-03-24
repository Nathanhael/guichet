import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './utils/trpc';
import useStore from './store/useStore';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
    mutations: {
      retry: 0,
    },
  },
});

const TRPCProvider = ({ children }: { children: React.ReactNode }) => {
  // Subscribe to token changes so the provider re-renders when auth state changes
  void useStore((s) => s.token);
  
  const [trpcClient] = React.useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/v1/trpc',
          headers() {
            const currentToken = useStore.getState().token;
            return {
              Authorization: currentToken ? `Bearer ${currentToken}` : undefined,
            };
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TRPCProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </TRPCProvider>
  </React.StrictMode>
);
