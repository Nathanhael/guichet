import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from './ollama.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider('http://localhost:11434', 'llama3');
    mockFetch.mockReset();
  });

  describe('chat', () => {
    it('sends correct request and parses response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Hello!' },
          prompt_eval_count: 10,
          eval_count: 5,
          model: 'llama3',
        }),
      });

      const result = await provider.chat({
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result).toEqual({
        content: 'Hello!',
        inputTokens: 10,
        outputTokens: 5,
        model: 'llama3',
      });

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.objectContaining({
        method: 'POST',
      }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(false);
      expect(body.model).toBe('llama3');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    });

    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(provider.chat({
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('Ollama request failed (500)');
    });

    it('falls back to default model when not specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'ok' },
          model: 'llama3',
        }),
      });

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('llama3');
    });

    it('handles missing token counts gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'ok' },
          model: 'llama3',
        }),
      });

      const result = await provider.chat({
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('includes keep_alive in request body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'ok' },
          model: 'llama3',
        }),
      });

      await provider.chat({
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.keep_alive).toBe('30m');
    });

    it('passes AbortSignal timeout to fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'ok' },
          model: 'llama3',
        }),
      });

      await provider.chat({
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions.signal).toBeDefined();
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('isAvailable', () => {
    it('returns true when Ollama responds OK', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when Ollama is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns false when Ollama returns error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('chatStream', () => {
    it('includes keep_alive in stream request body', async () => {
      const mockReader = {
        read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push(chunk);
      }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.keep_alive).toBe('30m');
    });

    it('yields content chunks from NDJSON stream', async () => {
      const chunks = [
        JSON.stringify({ message: { content: 'Hello' }, done: false }) + '\n',
        JSON.stringify({ message: { content: ' world' }, done: false }) + '\n',
        JSON.stringify({ message: { content: '!' }, done: true }) + '\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (chunkIndex >= chunks.length) return { done: true, value: undefined };
          const value = new TextEncoder().encode(chunks[chunkIndex++]);
          return { done: false, value };
        }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const result: string[] = [];
      for await (const chunk of provider.chatStream({
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        result.push(chunk);
      }

      expect(result).toEqual(['Hello', ' world', '!']);
    });
  });
});
