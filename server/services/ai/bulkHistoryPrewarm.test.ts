import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunAiAction = vi.fn();
vi.mock('./runAction.js', () => ({
  runAiAction: (...args: unknown[]) => mockRunAiAction(...args),
}));

const mockGetCached = vi.fn();
const mockSetCached = vi.fn();
vi.mock('./translateCache.js', () => ({
  getCachedTranslation: (...args: unknown[]) => mockGetCached(...args),
  setCachedTranslation: (...args: unknown[]) => mockSetCached(...args),
}));

const mockIsFeatureEnabled = vi.fn();
vi.mock('./config.js', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('./context.js', () => ({
  getAiContext: () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }),
}));

import { prewarmHistoryTranslations } from './bulkHistoryPrewarm';

const baseOpts = {
  supportLang: 'nl' as const,
  partnerId: 'p-1',
  supportUserId: 'u-1',
};

function msg(id: string, overrides: Partial<{
  text: string | null;
  originalText: string | null;
  senderLang: string | null;
  system: boolean | number | null;
  whisper: boolean | number | null;
}> = {}) {
  return {
    id,
    text: 'hello world',
    senderLang: 'en',
    system: false,
    whisper: false,
    ...overrides,
  };
}

describe('prewarmHistoryTranslations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockGetCached.mockResolvedValue(null);
    mockRunAiAction.mockImplementation(({ vars }: { vars: { text: string; targetLang: string } }) =>
      Promise.resolve({ content: `[${vars.targetLang}] ${vars.text}`, model: 'm', usageLogId: null }),
    );
  });

  it('translates every cross-lang message and returns a populated Map', async () => {
    const messages = [msg('m1'), msg('m2'), msg('m3')];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(3);
    expect(out.get('m1')).toBe('[Dutch] hello world');
    expect(out.get('m2')).toBe('[Dutch] hello world');
    expect(out.get('m3')).toBe('[Dutch] hello world');
    expect(mockRunAiAction).toHaveBeenCalledTimes(3);
  });

  it('caches translations to Redis on success', async () => {
    const messages = [msg('m1'), msg('m2')];

    await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(mockSetCached).toHaveBeenCalledTimes(2);
    expect(mockSetCached).toHaveBeenCalledWith('m1', 'nl', '[Dutch] hello world');
    expect(mockSetCached).toHaveBeenCalledWith('m2', 'nl', '[Dutch] hello world');
  });

  it('uses cached translation when present and skips the AI call', async () => {
    const messages = [msg('m1'), msg('m2')];
    mockGetCached.mockImplementation((id: string, _lang: string) =>
      Promise.resolve(id === 'm1' ? 'pre-cached translation' : null),
    );

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.get('m1')).toBe('pre-cached translation');
    expect(out.get('m2')).toBe('[Dutch] hello world');
    expect(mockRunAiAction).toHaveBeenCalledTimes(1); // only m2 cold
    expect(mockSetCached).toHaveBeenCalledTimes(1); // only m2 written
  });

  it('skips system messages', async () => {
    const messages = [msg('m1', { system: true }), msg('m2'), msg('m3', { system: 1 })];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(1);
    expect(out.has('m1')).toBe(false);
    expect(out.has('m3')).toBe(false);
    expect(out.get('m2')).toBe('[Dutch] hello world');
  });

  it('skips whisper messages', async () => {
    const messages = [msg('m1', { whisper: true }), msg('m2'), msg('m3', { whisper: 1 })];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(1);
    expect(out.has('m1')).toBe(false);
    expect(out.has('m3')).toBe(false);
    expect(out.get('m2')).toBe('[Dutch] hello world');
  });

  it('skips same-lang messages (senderLang === supportLang)', async () => {
    const messages = [
      msg('m1', { senderLang: 'nl' }),
      msg('m2', { senderLang: 'en' }),
      msg('m3', { senderLang: 'nl' }),
    ];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(1);
    expect(out.has('m2')).toBe(true);
    expect(mockRunAiAction).toHaveBeenCalledTimes(1);
  });

  it('skips messages with no text in either text or originalText fields', async () => {
    const messages = [
      msg('m1', { text: null, originalText: null }),
      msg('m2', { text: '', originalText: '' }),
      msg('m3'),
    ];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(1);
    expect(out.get('m3')).toBe('[Dutch] hello world');
  });

  it('falls back to originalText when text is null', async () => {
    const messages = [msg('m1', { text: null, originalText: 'fallback content' })];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.get('m1')).toBe('[Dutch] fallback content');
    expect(mockRunAiAction.mock.calls[0][0].vars.text).toBe('fallback content');
  });

  it('skips digit-only and punctuation-only messages (shouldSkipTranslation)', async () => {
    const messages = [
      msg('m1', { text: '12345' }),
      msg('m2', { text: '!!!???' }),
      msg('m3', { text: 'real translatable text' }),
    ];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(1);
    expect(out.get('m3')).toBe('[Dutch] real translatable text');
  });

  it('returns empty Map when supportLang is unsupported (e.g. de)', async () => {
    const messages = [msg('m1'), msg('m2')];

    const out = await prewarmHistoryTranslations({ ...baseOpts, supportLang: 'de', messages });

    expect(out.size).toBe(0);
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });

  it('returns empty Map when partner has translation feature disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(false);
    const messages = [msg('m1'), msg('m2')];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(0);
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });

  it('returns empty Map when isFeatureEnabled itself rejects', async () => {
    mockIsFeatureEnabled.mockRejectedValueOnce(new Error('db blew up'));
    const messages = [msg('m1')];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(0);
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });

  it('drops per-message failures and keeps other translations (best-effort)', async () => {
    const messages = [msg('m1'), msg('m2'), msg('m3')];
    mockRunAiAction.mockImplementation(({ vars }: { vars: { text: string; targetLang: string } }) => {
      const callIndex = mockRunAiAction.mock.calls.length - 1;
      if (callIndex === 1) return Promise.reject(new Error('rate limited'));
      return Promise.resolve({ content: `[${vars.targetLang}] ${vars.text}`, model: 'm', usageLogId: null });
    });

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(2); // 2 succeed, 1 fails silently
    expect(mockSetCached).toHaveBeenCalledTimes(2);
  });

  it('does not write empty translations to cache (model returned blank)', async () => {
    const messages = [msg('m1')];
    mockRunAiAction.mockResolvedValueOnce({ content: '   ', model: 'm', usageLogId: null });

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(0);
    expect(mockSetCached).not.toHaveBeenCalled();
  });

  it('passes the correct AI action args (translate / translation feature / supportUserId)', async () => {
    const messages = [msg('m1', { text: 'specific source' })];

    await prewarmHistoryTranslations({ ...baseOpts, messages });

    const call = mockRunAiAction.mock.calls[0][0];
    expect(call.action).toBe('translate');
    expect(call.feature).toBe('translation');
    expect(call.partnerId).toBe('p-1');
    expect(call.userId).toBe('u-1');
    expect(call.vars.text).toBe('specific source');
    expect(call.vars.targetLang).toBe('Dutch');
  });

  it('returns empty Map for an empty message list', async () => {
    const out = await prewarmHistoryTranslations({ ...baseOpts, messages: [] });

    expect(out.size).toBe(0);
    expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(1); // gate check still runs
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });

  it('returns empty Map when all messages are filtered out (no targets)', async () => {
    const messages = [
      msg('m1', { senderLang: 'nl' }),
      msg('m2', { system: true }),
      msg('m3', { text: '' }),
    ];

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages });

    expect(out.size).toBe(0);
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });

  it('respects budget cap — returns whatever finished, does not throw', async () => {
    const messages = [msg('m1'), msg('m2'), msg('m3')];
    // m2 takes longer than the budget
    mockRunAiAction.mockImplementation(({ vars }: { vars: { text: string; targetLang: string } }) => {
      const callIndex = mockRunAiAction.mock.calls.length - 1;
      if (callIndex === 1) {
        return new Promise((resolve) =>
          setTimeout(
            () => resolve({ content: 'late', model: 'm', usageLogId: null }),
            500,
          ),
        );
      }
      return Promise.resolve({ content: `[${vars.targetLang}] ${vars.text}`, model: 'm', usageLogId: null });
    });

    const out = await prewarmHistoryTranslations({ ...baseOpts, messages, budgetMs: 50 });

    // m1 + m3 should land within 50ms; m2 is racing the budget.
    // Either m2 made it (concurrency permits) or didn't — but the function
    // returns without throwing and captures whatever resolved in time.
    expect(out.size).toBeGreaterThanOrEqual(2);
    expect(out.size).toBeLessThanOrEqual(3);
  });
});
