import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI service barrel — healthCheck uses getProvider().isAvailable().
const mockGetProvider = vi.fn();

vi.mock('../../../services/ai/index.js', () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  runAiAction: vi.fn(),
  getCachedSummary: vi.fn(),
  setCachedSummary: vi.fn(),
  formatMessagesForAi: vi.fn(),
  verifyTicketOwnership: vi.fn(),
  fetchTicketMessages: vi.fn(),
  getCachedTranslation: vi.fn(),
  setCachedTranslation: vi.fn(),
}));

import { aiRouter } from '../ai.js';

type CallerCtx = Parameters<typeof aiRouter.createCaller>[0];

const baseUser = {
  id: 'u-1',
  name: 'User',
  email: 'u@test',
  role: 'support' as const,
  partnerId: 'p-1',
  isPlatformOperator: false,
  isExternal: false,
  lang: 'en' as const,
};

function makeCaller() {
  return aiRouter.createCaller({ user: baseUser } as unknown as CallerCtx);
}

function fakeProvider(available: boolean) {
  return {
    name: 'fake',
    chat: vi.fn(),
    chatStream: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(available),
  };
}

describe('aiRouter.healthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available=true with an ISO lastChecked when provider is reachable', async () => {
    const provider = fakeProvider(true);
    mockGetProvider.mockResolvedValue(provider);
    const caller = makeCaller();

    const result = await caller.healthCheck();

    expect(result.available).toBe(true);
    expect(typeof result.lastChecked).toBe('string');
    expect(Number.isNaN(Date.parse(result.lastChecked))).toBe(false);
  });

  it('returns available=false when provider isAvailable resolves to false', async () => {
    const provider = fakeProvider(false);
    mockGetProvider.mockResolvedValue(provider);
    const caller = makeCaller();

    const result = await caller.healthCheck();

    expect(result.available).toBe(false);
    expect(typeof result.lastChecked).toBe('string');
  });

  it('returns available=false when getProvider rejects (no provider configured)', async () => {
    mockGetProvider.mockRejectedValue(new Error('no provider'));
    const caller = makeCaller();

    const result = await caller.healthCheck();

    expect(result.available).toBe(false);
    expect(typeof result.lastChecked).toBe('string');
  });

  it('returns available=false when isAvailable itself throws', async () => {
    const provider = {
      name: 'broken',
      chat: vi.fn(),
      chatStream: vi.fn(),
      isAvailable: vi.fn().mockRejectedValue(new Error('boom')),
    };
    mockGetProvider.mockResolvedValue(provider);
    const caller = makeCaller();

    const result = await caller.healthCheck();

    expect(result.available).toBe(false);
  });

  it('does not throw on invocation — health is a status, not an error path', async () => {
    mockGetProvider.mockRejectedValue(new Error('unconfigured'));
    const caller = makeCaller();
    await expect(caller.healthCheck()).resolves.toBeDefined();
  });

  it('requires authenticated partner context (rejects empty ctx)', async () => {
    // partnerScopedProcedure must reject when no user/partnerId is present.
    const caller = aiRouter.createCaller({ user: null } as unknown as CallerCtx);
    await expect(caller.healthCheck()).rejects.toBeDefined();
  });

  it('lastChecked is recent (within 5 seconds of now)', async () => {
    const provider = fakeProvider(true);
    mockGetProvider.mockResolvedValue(provider);
    const caller = makeCaller();

    const before = Date.now();
    const result = await caller.healthCheck();
    const after = Date.now();

    const checked = Date.parse(result.lastChecked);
    expect(checked).toBeGreaterThanOrEqual(before);
    expect(checked).toBeLessThanOrEqual(after);
  });
});
