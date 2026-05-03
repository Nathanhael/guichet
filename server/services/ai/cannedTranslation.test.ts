import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunAiAction = vi.fn();
vi.mock('./runAction.js', () => ({
  runAiAction: (...args: unknown[]) => mockRunAiAction(...args),
}));

const mockIsFeatureEnabled = vi.fn();
vi.mock('./config.js', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

const warnSpy = vi.fn();
vi.mock('./context.js', () => ({
  getAiContext: () => ({
    logger: { info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() },
  }),
}));

import { translateCanned, isCannedTranslationEnabled } from './cannedTranslation';

describe('translateCanned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translates to all non-source languages', async () => {
    mockRunAiAction.mockImplementation(({ vars }: { vars: { targetLang: string } }) =>
      Promise.resolve({ content: `[${vars.targetLang}] hello`, model: 'm', usageLogId: null }),
    );

    const out = await translateCanned('p-1', 'u-1', 'hello', 'en');

    expect(mockRunAiAction).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ nl: '[Dutch] hello', fr: '[French] hello' });
  });

  it('uses translate action and cannedTranslation feature', async () => {
    mockRunAiAction.mockResolvedValue({ content: 'x', model: 'm', usageLogId: null });

    await translateCanned('p-1', 'u-1', 'hello', 'nl');

    for (const call of mockRunAiAction.mock.calls) {
      expect(call[0].action).toBe('translate');
      expect(call[0].feature).toBe('cannedTranslation');
      expect(call[0].partnerId).toBe('p-1');
      expect(call[0].userId).toBe('u-1');
      expect(call[0].vars.text).toBe('hello');
    }

    const targetLangs = mockRunAiAction.mock.calls.map((c) => c[0].vars.targetLang).sort();
    expect(targetLangs).toEqual(['English', 'French']);
  });

  it('drops failures and returns partial results (graceful)', async () => {
    mockRunAiAction.mockImplementation(({ vars }: { vars: { targetLang: string } }) => {
      if (vars.targetLang === 'French') return Promise.reject(new Error('rate limited'));
      return Promise.resolve({ content: `ok ${vars.targetLang}`, model: 'm', usageLogId: null });
    });

    const out = await translateCanned('p-1', 'u-1', 'hello', 'en');

    expect(out).toEqual({ nl: 'ok Dutch' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('returns empty object when all translations fail', async () => {
    mockRunAiAction.mockRejectedValue(new Error('provider down'));

    const out = await translateCanned('p-1', 'u-1', 'hello', 'en');

    expect(out).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('respects langs filter — only translates listed targets', async () => {
    mockRunAiAction.mockResolvedValue({ content: 'x', model: 'm', usageLogId: null });

    await translateCanned('p-1', 'u-1', 'hello', 'en', ['en', 'fr']);

    expect(mockRunAiAction).toHaveBeenCalledTimes(1);
    expect(mockRunAiAction.mock.calls[0][0].vars.targetLang).toBe('French');
  });

  it('returns empty when source equals only listed lang', async () => {
    const out = await translateCanned('p-1', 'u-1', 'hello', 'en', ['en']);

    expect(out).toEqual({});
    expect(mockRunAiAction).not.toHaveBeenCalled();
  });
});

describe('isCannedTranslationEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to isFeatureEnabled with the cannedTranslation key', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const result = await isCannedTranslationEnabled('p-1');
    expect(result).toBe(true);
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('p-1', 'cannedTranslation');
  });

  it('returns false when partner has the feature off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const result = await isCannedTranslationEnabled('p-1');
    expect(result).toBe(false);
  });
});
