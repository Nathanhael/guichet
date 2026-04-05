/**
 * Shared test helpers for platform component tests.
 *
 * Strategy: We mock tRPC at the hook level so each component renders in
 * isolation without needing a full QueryClient / tRPC provider tree.
 * The `useT` hook is mocked to pass-through the key (easy to assert on).
 */

import { vi } from 'vitest';
import type { Partner, GlobalUser } from '../components/platform/types';

/* ------------------------------------------------------------------ */
/*  i18n mock – returns the key itself so assertions are language-agnostic */
/* ------------------------------------------------------------------ */
export function mockUseT() {
  return (key: string) => key;
}

/* ------------------------------------------------------------------ */
/*  Factory helpers for test data                                      */
/* ------------------------------------------------------------------ */

let idCounter = 0;
export function makePartner(overrides: Partial<Partner> = {}): Partner {
  idCounter += 1;
  return {
    id: `partner-${idCounter}`,
    name: `Test Partner ${idCounter}`,
    logoUrl: null,
    industry: 'Tech',
    status: 'active',
    authMethod: 'sso',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeUser(overrides: Partial<GlobalUser> = {}): GlobalUser {
  idCounter += 1;
  return {
    id: `user-${idCounter}`,
    name: `Test User ${idCounter}`,
    email: `user${idCounter}@example.com`,
    isPlatformOperator: false,
    deletedAt: null,
    lastActiveAt: '2025-06-01T12:00:00Z',
    externalId: null,
    partnerMemberships: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  tRPC mock builder                                                  */
/* ------------------------------------------------------------------ */

interface MutationMock {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
}

export function makeMutationMock(overrides: Partial<MutationMock> = {}): MutationMock {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  };
}

interface QueryMock<T> {
  data: T | undefined;
  isLoading: boolean;
}

export function makeQueryMock<T>(data: T): QueryMock<T> {
  return { data, isLoading: false };
}

export function makeUseUtilsMock() {
  return () => ({
    platform: {
      listPartners: { invalidate: vi.fn(), getData: vi.fn(), fetch: vi.fn() },
      listGlobalUsers: { invalidate: vi.fn(), getData: vi.fn(), fetch: vi.fn() },
    },
  });
}
