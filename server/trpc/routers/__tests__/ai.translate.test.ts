import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI service barrel — translateMessage uses runAiAction + cache fns.
const mockRunAiAction = vi.fn();
const mockGetCachedTranslation = vi.fn();
const mockSetCachedTranslation = vi.fn();

vi.mock('../../../services/ai/index.js', () => ({
  runAiAction: (...args: unknown[]) => mockRunAiAction(...args),
  getCachedSummary: vi.fn(),
  setCachedSummary: vi.fn(),
  formatMessagesForAi: vi.fn(),
  verifyTicketOwnership: vi.fn(),
  fetchTicketMessages: vi.fn(),
  getCachedTranslation: (...args: unknown[]) => mockGetCachedTranslation(...args),
  setCachedTranslation: (...args: unknown[]) => mockSetCachedTranslation(...args),
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

describe('aiRouter.translateMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when messageId is missing', async () => {
    const caller = makeCaller();
    await expect(
      // @ts-expect-error — verifying schema enforcement at runtime
      caller.translateMessage({ text: 'hello', targetLang: 'fr' }),
    ).rejects.toBeDefined();
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });

  it('returns cached translation without calling runAiAction on cache hit', async () => {
    mockGetCachedTranslation.mockResolvedValue('Bonjour');
    const caller = makeCaller();

    const result = await caller.translateMessage({
      messageId: 'msg-99',
      text: 'Hello',
      targetLang: 'fr',
    });

    expect(result).toEqual({ translated: 'Bonjour' });
    expect(mockGetCachedTranslation).toHaveBeenCalledWith('msg-99', 'fr');
    expect(mockRunAiAction).not.toHaveBeenCalled();
    expect(mockSetCachedTranslation).not.toHaveBeenCalled();
  });

  it('calls runAiAction and caches result on cache miss', async () => {
    mockGetCachedTranslation.mockResolvedValue(null);
    mockRunAiAction.mockResolvedValue({ content: '  Hallo  ', model: 'm' });
    const caller = makeCaller();

    const result = await caller.translateMessage({
      messageId: 'msg-42',
      text: 'Hello',
      targetLang: 'nl',
    });

    expect(result).toEqual({ translated: 'Hallo' });
    expect(mockGetCachedTranslation).toHaveBeenCalledWith('msg-42', 'nl');
    expect(mockRunAiAction).toHaveBeenCalledTimes(1);
    expect(mockSetCachedTranslation).toHaveBeenCalledWith('msg-42', 'nl', 'Hallo');
  });
});
