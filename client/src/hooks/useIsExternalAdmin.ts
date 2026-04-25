import useStore from '../store/useStore';
import type { StoreState } from '../types';
import { trpc } from '../utils/trpc';

/**
 * Returns whether the current user is an Azure B2B guest admin.
 *
 * The Zustand store carries an `isExternal` flag stamped at SSO callback and
 * partner-switch time, but nothing refreshes it within a session. A platform
 * operator demoting/promoting a guest would stay invisible to this hook
 * until the next re-login. We query `trpc.user.me` and refetch on a 60s
 * interval (and on window focus) so the flag converges on server truth.
 *
 * Server-side destructive admin procedures already enforce the real check,
 * so the failure mode this closes is purely a UI lag — the buttons remain
 * clickable after a live demotion/promotion until the refetch lands.
 */
export function useIsExternalAdmin(): boolean {
  const storeFlag = useStore((s: StoreState) => !!s.user?.isExternal);
  const { data } = trpc.user.me.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  return data ? !!data.isExternal : storeFlag;
}
