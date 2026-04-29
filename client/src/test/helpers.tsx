/**
 * Shared test helpers for platform component tests.
 *
 * Strategy: We mock tRPC at the hook level so each component renders in
 * isolation without needing a full QueryClient / tRPC provider tree.
 * The `useT` hook is mocked to pass-through the key (easy to assert on).
 */

import { vi } from 'vitest';
import type { Partner, GlobalUser } from '../components/platform/types';
import type { Message } from '../types';

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
    industry: 'Tech',
    status: 'active',
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
  // Intersection: callable as a typed mutator AND retains vi.fn's mock API
  // (mockImplementation, toHaveBeenCalledWith, etc).
  mutate: ((input: unknown) => void) & ReturnType<typeof vi.fn>;
  isPending: boolean;
  isSuccess?: boolean;
  data?: unknown;
  error?: { message: string } | null;
  reset?: (() => void) & ReturnType<typeof vi.fn>;
}

export function makeMutationMock(overrides: Partial<MutationMock> = {}): MutationMock {
  return {
    mutate: vi.fn() as MutationMock['mutate'],
    isPending: false,
    isSuccess: false,
    data: undefined,
    error: null,
    reset: vi.fn() as MutationMock['reset'],
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

/* ------------------------------------------------------------------ */
/*  Message factories — Bundle C slice 2 (#77)                          */
/* ------------------------------------------------------------------ */

let _msgIdCounter = 0;
export function makeMessage(overrides: Partial<Message> = {}): Message {
  _msgIdCounter += 1;
  const id = `msg-${_msgIdCounter}`;
  const ts = new Date(2026, 3, 29, 12, 0, _msgIdCounter).toISOString();
  return {
    id,
    ticketId: 't-1',
    senderId: 'u-1',
    senderName: 'Alice',
    senderRole: 'agent',
    senderLang: 'en',
    originalText: `Test message ${_msgIdCounter}`,
    improvedText: '',
    processedText: '',
    text: `Test message ${_msgIdCounter}`,
    whisper: false,
    system: false,
    translationSkipped: false,
    fallback: false,
    timestamp: ts,
    createdAt: ts,
    reactions: {},
    ...overrides,
  };
}

export function makeMessageWithAttachment(overrides: Partial<Message> = {}): Message {
  return makeMessage({
    attachments: [{ url: '/uploads/x.png', name: 'x.png', mimeType: 'image/png', size: 1234 }],
    ...overrides,
  });
}

export function makeMessageWithQuote(overrides: Partial<Message> = {}): Message {
  return makeMessage({
    replyTo: { id: 'msg-orig', senderName: 'Bob', text: 'Original message' },
    ...overrides,
  });
}

export function makeMessageWithLinkPreview(overrides: Partial<Message> = {}): Message {
  return makeMessage({
    linkPreviews: [{ url: 'https://example.com', title: 'Example', description: 'Site description' }],
    ...overrides,
  });
}

export function makeDeletedMessage(overrides: Partial<Message> = {}): Message {
  return makeMessage({
    deletedAt: new Date().toISOString(),
    text: '',
    originalText: '',
    ...overrides,
  });
}

export function makeUseUtilsMock() {
  return () => ({
    platform: {
      listPartners: { invalidate: vi.fn(), getData: vi.fn(), fetch: vi.fn() },
      listGlobalUsers: { invalidate: vi.fn(), getData: vi.fn(), fetch: vi.fn() },
    },
  });
}
