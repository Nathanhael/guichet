import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCached = vi.fn();
const mockSetCached = vi.fn();
const mockRunAiAction = vi.fn();
const mockIsFeatureEnabled = vi.fn();

vi.mock('./translateCache.js', () => ({
  getCachedTranslation: (...args: unknown[]) => mockGetCached(...args),
  setCachedTranslation: (...args: unknown[]) => mockSetCached(...args),
}));

vi.mock('./runAction.js', () => ({
  runAiAction: (...args: unknown[]) => mockRunAiAction(...args),
}));

vi.mock('./config.js', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('./context.js', () => ({
  getAiContext: () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }),
}));

describe('translateFirstAgentMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockResolvedValue(null);
    mockSetCached.mockResolvedValue(undefined);
    mockIsFeatureEnabled.mockResolvedValue(true);
  });

  const baseOpts = {
    messageId: 'msg-1',
    text: 'Hallo, ik heb een probleem',
    senderLang: 'nl',
    supportLang: 'fr',
    partnerId: 'p_a',
    supportUserId: 'u_support',
  };

  it('returns null when senderLang === supportLang', async () => {
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage({ ...baseOpts, senderLang: 'fr' });
    expect(result).toBeNull();
    expect(mockRunAiAction).not.toHaveBeenCalled();
    expect(mockGetCached).not.toHaveBeenCalled();
  });

  it('returns null for unsupported supportLang', async () => {
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage({ ...baseOpts, supportLang: 'de' });
    expect(result).toBeNull();
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('returns null when text is empty / whitespace', async () => {
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    expect(await translateFirstAgentMessage({ ...baseOpts, text: '' })).toBeNull();
    expect(await translateFirstAgentMessage({ ...baseOpts, text: '   ' })).toBeNull();
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('returns null when senderLang missing', async () => {
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage({ ...baseOpts, senderLang: '' });
    expect(result).toBeNull();
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('returns null when partner translation feature is disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(false);
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage(baseOpts);
    expect(result).toBeNull();
    expect(mockGetCached).not.toHaveBeenCalled();
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });

  it('returns cached translation without calling AI on cache hit', async () => {
    mockGetCached.mockResolvedValueOnce('Bonjour, j’ai un problème');
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage(baseOpts);
    expect(result).toBe('Bonjour, j’ai un problème');
    expect(mockGetCached).toHaveBeenCalledWith('msg-1', 'fr');
    expect(mockRunAiAction).not.toHaveBeenCalled();
    expect(mockSetCached).not.toHaveBeenCalled();
  });

  it('calls AI on cache miss and caches result', async () => {
    mockRunAiAction.mockResolvedValueOnce({
      content: '  Bonjour  ',
      model: 'gpt-4o',
      usageLogId: 'log-1',
    });
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage(baseOpts);
    expect(result).toBe('Bonjour');
    expect(mockRunAiAction).toHaveBeenCalledTimes(1);
    expect(mockRunAiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: 'p_a',
        userId: 'u_support',
        feature: 'translation',
        action: 'translate',
        vars: expect.objectContaining({
          text: 'Hallo, ik heb een probleem',
          targetLang: 'French',
        }),
      }),
    );
    expect(mockSetCached).toHaveBeenCalledWith('msg-1', 'fr', 'Bonjour');
  });

  it('maps each supported lang to the correct full name', async () => {
    mockRunAiAction.mockResolvedValue({ content: 'x', model: 'm', usageLogId: null });
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');

    await translateFirstAgentMessage({ ...baseOpts, supportLang: 'nl', senderLang: 'en' });
    expect(mockRunAiAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ vars: expect.objectContaining({ targetLang: 'Dutch' }) }),
    );

    await translateFirstAgentMessage({ ...baseOpts, supportLang: 'en', senderLang: 'nl' });
    expect(mockRunAiAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ vars: expect.objectContaining({ targetLang: 'English' }) }),
    );
  });

  it('returns null and swallows error when AI call throws', async () => {
    mockRunAiAction.mockRejectedValueOnce(new Error('provider down'));
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage(baseOpts);
    expect(result).toBeNull();
    expect(mockSetCached).not.toHaveBeenCalled();
  });

  it('returns null when AI returns empty/whitespace content', async () => {
    mockRunAiAction.mockResolvedValueOnce({ content: '   ', model: 'm', usageLogId: null });
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage(baseOpts);
    expect(result).toBeNull();
    expect(mockSetCached).not.toHaveBeenCalled();
  });

  it('returns null when isFeatureEnabled throws', async () => {
    mockIsFeatureEnabled.mockRejectedValueOnce(new Error('db down'));
    const { translateFirstAgentMessage } = await import('./firstMessageTranslate.js');
    const result = await translateFirstAgentMessage(baseOpts);
    expect(result).toBeNull();
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });
});
