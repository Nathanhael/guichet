/**
 * Behavior test for AdminTeam: the admin roster query (`partner.listAdmins`)
 * must never be invoked when the viewer is a B2B guest (`isExternal=true`).
 *
 * Defense-in-depth for the server gate (`internalAdminReadProcedure`). Spy on
 * the underlying tRPC useQuery — asserting the rendered DOM would be a smoke
 * test, which the project mandate forbids.
 *
 * Spec: docs/superpowers/specs/2026-04-25-hide-admin-roster-from-guests.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const { listAdminsUseQuery, isExternalRef, mockMembership } = vi.hoisted(() => ({
  listAdminsUseQuery: vi.fn(
    (_input?: undefined, _opts?: { enabled?: boolean }): { data: unknown; isLoading: boolean } => ({
      data: undefined,
      isLoading: false,
    }),
  ),
  isExternalRef: { value: false },
  mockMembership: {
    id: 'm-active',
    role: 'admin',
    manifest: { departments: [] },
  },
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../hooks/useIsExternalAdmin', () => ({
  useIsExternalAdmin: () => isExternalRef.value,
}));

vi.mock('../../../store/useStore', () => ({
  __esModule: true,
  default: () => ({}),
  useStoreShallow: <T,>(selector: (s: unknown) => T) =>
    selector({ activeMembershipId: 'm-active', memberships: [mockMembership] }),
}));

vi.mock('../../Toast', () => ({ default: () => null }));
vi.mock('../../ConfirmDialog', () => ({ default: () => null }));
vi.mock('../../GuestBadge', () => ({ default: () => null }));
vi.mock('../MemberAuditDrawer', () => ({ default: () => null }));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      partner: {
        listMembers: { invalidate: vi.fn() },
        memberStats: { invalidate: vi.fn() },
      },
    }),
    partner: {
      listMembers: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      memberStats: {
        useQuery: () => ({ data: { total: 0, support: 0, agents: 0, dormant: 0 } }),
      },
      listAdmins: {
        useQuery: listAdminsUseQuery,
      },
      removeMember: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      updateMember: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      inviteExternalUser: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

import AdminTeam from '../AdminTeam';

describe('AdminTeam — listAdmins guest gating', () => {
  beforeEach(() => {
    listAdminsUseQuery.mockClear();
  });

  it('passes enabled=false to listAdmins.useQuery when viewer is a B2B guest (isExternal=true)', () => {
    isExternalRef.value = true;
    render(<AdminTeam />);

    // The hook is invoked at least once during render (React calls hooks
    // unconditionally), but its `enabled` option must be false so TanStack
    // Query never fires the network request.
    expect(listAdminsUseQuery).toHaveBeenCalled();
    for (const call of listAdminsUseQuery.mock.calls) {
      const opts = call[1] as { enabled?: boolean } | undefined;
      expect(opts?.enabled).toBe(false);
    }
  });

  it('passes enabled=true to listAdmins.useQuery when viewer is an internal admin (isExternal=false)', () => {
    // Positive control: proves the gate is conditional on isExternal, not
    // hard-disabled. Without this, the failing-when-external case could pass
    // trivially (e.g. if the query were always disabled).
    isExternalRef.value = false;
    render(<AdminTeam />);

    expect(listAdminsUseQuery).toHaveBeenCalled();
    const lastCall = listAdminsUseQuery.mock.calls.at(-1);
    const opts = lastCall?.[1] as { enabled?: boolean } | undefined;
    expect(opts?.enabled).toBe(true);
  });
});
