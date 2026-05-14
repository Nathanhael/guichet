// Slice 7.5: improveMessage returns usageLogId so the client can later
// annotate the row via ai.markImproveResult / submitFeedback.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunAiAction = vi.fn();

vi.mock('../../../services/ai/index.js', () => ({
  runAiAction: (...args: unknown[]) => mockRunAiAction(...args),
  getProvider: vi.fn(),
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

describe('aiRouter.improveMessage — usageLogId pass-through (slice 7.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns improved + usageLogId from runAiAction', async () => {
    mockRunAiAction.mockResolvedValue({
      content: '  Polished message.  ',
      model: 'gpt-test',
      usageLogId: 'usage-log-42',
    });

    const result = await makeCaller().improveMessage({
      text: 'short rough draft of a message',
      role: 'support',
    });

    expect(result.improved).toBe('Polished message.');
    expect(result.usageLogId).toBe('usage-log-42');
  });

  it('forwards null usageLogId when the underlying log write failed', async () => {
    mockRunAiAction.mockResolvedValue({
      content: 'x',
      model: 'm',
      usageLogId: null,
    });

    const result = await makeCaller().improveMessage({
      text: 'short rough draft of a message',
      role: 'agent',
    });

    expect(result.usageLogId).toBeNull();
  });

  it('rejects digits-only input before calling AI (avoids meta-refusal in diff modal)', async () => {
    await expect(
      makeCaller().improveMessage({
        text: '5555555555555555555555555555',
        role: 'support',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });

  it('rejects punctuation-only input before calling AI', async () => {
    await expect(
      makeCaller().improveMessage({
        text: '!!!!!!!!!!!!!!!!!!!',
        role: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });
});
