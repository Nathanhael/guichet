import { createTRPCReact } from '@trpc/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../server/trpc/router';

export const trpc = createTRPCReact<AppRouter>();

/** Vanilla tRPC client for use outside React components (e.g. Zustand slices). */
export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/v1/trpc',
      fetch(url, options) {
        return fetch(url, { ...options, credentials: 'include' });
      },
    }),
  ],
});
