// Verifies the GDPR Art. 21 anonymisation path: when a worker has
// `memberships.aiOptOut = true`, `runAiAction` must pass `userId = null` to
// `logUsage` on both the success and the error code paths, without changing
// any other behaviour.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsFeatureEnabled = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetProvider = vi.fn();
const mockGetPromptTemplate = vi.fn();
const mockInterpolate = vi.fn();
const mockLogUsage = vi.fn();
const mockGetVerbosity = vi.fn();
const mockIsUserOptedOut = vi.fn();

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

vi.mock('./optOut.js', () => ({
  isUserOptedOut: (...args: unknown[]) => mockIsUserOptedOut(...args),
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

describe('runAiAction — opt-out anonymisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockGetPromptTemplate.mockResolvedValue('translate: {{text}}');
    mockInterpolate.mockReturnValue('translate: hello');
    mockGetVerbosity.mockResolvedValue('metadata');
  });

  it('writes the real userId when opt-out is false', async () => {
    mockIsUserOptedOut.mockResolvedValue(false);
    mockGetProvider.mockResolvedValue(fakeProvider());

    await runAiAction(baseOpts);

    expect(mockLogUsage).toHaveBeenCalledTimes(1);
    const entry = mockLogUsage.mock.calls[0][0];
    expect(entry.userId).toBe('u-1');
    expect(entry.success).toBe(true);
  });

  it('writes userId = null when opt-out is true (success path)', async () => {
    mockIsUserOptedOut.mockResolvedValue(true);
    mockGetProvider.mockResolvedValue(fakeProvider());

    await runAiAction(baseOpts);

    expect(mockLogUsage).toHaveBeenCalledTimes(1);
    const entry = mockLogUsage.mock.calls[0][0];
    expect(entry.userId).toBeNull();
    expect(entry.partnerId).toBe('p-1');
    expect(entry.success).toBe(true);
    // Provider call still happened — anonymisation only severs identity.
    expect(entry.action).toBe('translate');
    expect(entry.inputTokens).toBe(5);
  });

  it('writes userId = null when opt-out is true (error path)', async () => {
    mockIsUserOptedOut.mockResolvedValue(true);
    mockGetProvider.mockResolvedValue({
      name: 'fake',
      chat: vi.fn().mockRejectedValue(new Error('upstream timeout')),
      chatStream: vi.fn(),
      isAvailable: vi.fn(),
    });

    await expect(runAiAction(baseOpts)).rejects.toBeDefined();

    const entry = mockLogUsage.mock.calls[0][0];
    expect(entry.userId).toBeNull();
    expect(entry.success).toBe(false);
    expect(entry.errorMessage).toContain('upstream timeout');
  });

  it('swallows logUsage rejection on the error path and still throws the original provider error', async () => {
    // Regression: prior to the review-feedback fix, the error-path logUsage
    // call was fire-and-forget. If logUsage rejected (e.g. DB hiccup), the
    // rejection was unhandled and the anonymized row was silently lost.
    // Now the call is awaited inside a try/catch — verify both that the
    // primary throw is preserved and that a logUsage failure does not
    // shadow it.
    mockIsUserOptedOut.mockResolvedValue(true);
    mockGetProvider.mockResolvedValue({
      name: 'fake',
      chat: vi.fn().mockRejectedValue(new Error('upstream timeout')),
      chatStream: vi.fn(),
      isAvailable: vi.fn(),
    });
    mockLogUsage.mockRejectedValueOnce(new Error('db connection lost'));

    // The caller still sees the AI-service unavailable error, NOT the db error.
    await expect(runAiAction(baseOpts)).rejects.toMatchObject({
      message: expect.stringContaining('AI service unavailable'),
    });
    // logUsage was still attempted with userId nulled.
    expect(mockLogUsage).toHaveBeenCalledTimes(1);
    expect(mockLogUsage.mock.calls[0][0].userId).toBeNull();
  });

  it('runs the provider chat call regardless of opt-out (functional preservation)', async () => {
    mockIsUserOptedOut.mockResolvedValue(true);
    const provider = fakeProvider();
    mockGetProvider.mockResolvedValue(provider);

    const result = await runAiAction(baseOpts);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('AI says hi');
  });
});
