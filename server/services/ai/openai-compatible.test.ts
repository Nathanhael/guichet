import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OpenAiCompatibleProvider', () => {
  let provider: OpenAiCompatibleProvider;

  beforeEach(() => {
    provider = new OpenAiCompatibleProvider(
      'http://localhost:1234',
      'test-model',
      'test-key',
    );
    mockFetch.mockReset();
  });

  describe('chat', () => {
    it('sends correct request and parses response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello!' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: 'test-model',
        }),
      });

      const result = await provider.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result).toEqual({
        content: 'Hello!',
        inputTokens: 10,
        outputTokens: 5,
        model: 'test-model',
      });
    });

    it('passes AbortSignal timeout to fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'test-model',
        }),
      });

      await provider.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions.signal).toBeDefined();
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('throws descriptive error on timeout', async () => {
      const abortError = new DOMException('Signal timed out', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(provider.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('AI request timed out');
    });
  });

  describe('isAvailable', () => {
    it('returns true when API responds OK', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when API is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await provider.isAvailable()).toBe(false);
    });
  });
});
