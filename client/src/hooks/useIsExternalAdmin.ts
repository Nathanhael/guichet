import useStore from '../store/useStore';
import type { StoreState } from '../types';

/**
 * Returns whether the current user is an Azure B2B guest admin.
 *
 * Parent: docs/superpowers/plans/2026-04-17-guest-admin-visible-disable.md
 *
 * Note: the plan originally called for `trpc.user.me.useQuery`, but the
 * Zustand store already carries a fresh `isExternal` flag (stamped by the
 * SSO callback and refreshed on partner switch). Reading from the store
 * matches `ChatHeader` / `UserMenu` and avoids a redundant fetch.
 */
export function useIsExternalAdmin(): boolean {
  return useStore((s: StoreState) => !!s.user?.isExternal);
}
