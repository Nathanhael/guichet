// Slice 2.5: verifies that audit verbosity gates the prompt/response payload
// passed to logUsage. 'full' captures both; 'metadata' (default) captures neither.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsFeatureEnabled = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetProvider = vi.fn();
const mockGetPromptTemplate = vi.fn();
const mockInterpolate = vi.fn();
const mockLogUsage = vi.fn();
const mockGetVerbosity = vi.fn();

vi.mock('./index.js', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  getPromptTemplate: (...args: unknown[]) => mockGetPromptTemplate(...args),
  interpolate: (...args: unknown[]) => mockInterpolate(...args),
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('./context.js', () => ({
  getAiContext: () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }),
}));

vi.mock('./auditVerbosity.js', () => ({
  getEffectiveAuditVerbosity: (...args: unknown[]) => mockGetVerbosity(...args),
}));

import { runAiAction } from './runAction';

function fakeProvider(content = 'AI says hi') {
  return {
    name: 'fake',
    chat: vi.fn().mockResolvedValue({
      content,
      model: 'gpt-test',
      inputTokens: 5,
      outputTokens: 3,
    }),
    chatStream: vi.fn(),
    isAvailable: vi.fn(),
  };
}

const baseOpts = {
  partnerId: 'p-1',
  userId: 'u-1',
  feature: 'translation' as const,
  action: 'translate' as const,
  vars: { text: 'hello' },
};

describe('runAiAction — audit verbosity gating (slice 2.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockGetPromptTemplate.mockResolvedValue('translate: {{text}}');
    mockInterpolate.mockReturnValue('translate: hello');
  });

  it('captures prompt and response in usage entry when verbosity is "full"', async () => {
    mockGetVerbosity.mockResolvedValue('full');
    mockGetProvider.mockResolvedValue(fakeProvider('AI says hi'));

    await runAiAction(baseOpts);

    expect(mockLogUsage).toHaveBeenCalledTimes(1);
    const entry = mockLogUsage.mock.calls[0][0];
    expect(entry.prompt).toBe('translate: hello');
    expect(entry.response).toBe('AI says hi');
    expect(entry.success).toBe(true);
  });

  it('OMITS prompt and response when verbosity is "metadata"', async () => {
    mockGetVerbosity.mockResolvedValue('metadata');
    mockGetProvider.mockResolvedValue(fakeProvider('AI says hi'));

    await runAiAction(baseOpts);

    const entry = mockLogUsage.mock.calls[0][0];
    expect(entry.prompt).toBeUndefined();
    expect(entry.response).toBeUndefined();
    // Sanity: the metadata path still logs token counts and latency
    expect(entry.inputTokens).toBe(5);
    expect(entry.outputTokens).toBe(3);
    expect(entry.success).toBe(true);
  });

  it('captures prompt (but no response) on the failure path when verbosity is "full"', async () => {
    mockGetVerbosity.mockResolvedValue('full');
    const provider = {
      name: 'fake',
      chat: vi.fn().mockRejectedValue(new Error('upstream timeout')),
      chatStream: vi.fn(),
      isAvailable: vi.fn(),
    };
    mockGetProvider.mockResolvedValue(provider);

    await expect(runAiAction(baseOpts)).rejects.toBeDefined();

    const entry = mockLogUsage.mock.calls[0][0];
    expect(entry.success).toBe(false);
    expect(entry.prompt).toBe('translate: hello');
    expect(entry.errorMessage).toContain('upstream timeout');
  });

  it('omits prompt on the failure path when verbosity is "metadata"', async () => {
    mockGetVerbosity.mockResolvedValue('metadata');
    const provider = {
      name: 'fake',
      chat: vi.fn().mockRejectedValue(new Error('upstream timeout')),
      chatStream: vi.fn(),
      isAvailable: vi.fn(),
    };
    mockGetProvider.mockResolvedValue(provider);

    await expect(runAiAction(baseOpts)).rejects.toBeDefined();

    const entry = mockLogUsage.mock.calls[0][0];
    expect(entry.prompt).toBeUndefined();
    expect(entry.success).toBe(false);
  });
});
