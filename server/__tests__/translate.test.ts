import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
vi.mock('../db.js', () => ({
  get: vi.fn().mockResolvedValue(undefined),
  run: vi.fn().mockResolvedValue({ changes: 1 }),
  query: vi.fn().mockResolvedValue([]),
}));

// Mock the logger to avoid pino-pretty issues in tests
vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock global fetch for Ollama
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks are set up
import { processMessage } from '../services/translate.js';

describe('Translation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return fallback when Ollama is unavailable', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const result = await processMessage('Test message', 'agent', 'nl', 'fr');
    expect(result.fallback).toBe(true);
    expect(result.processedText).toBe('Test message');
    expect(result.improvedText).toBe('Test message');
  });

  it('should skip translation when languages match', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'Improved message' }),
    });

    const result = await processMessage('Test message', 'agent', 'nl', 'nl');
    expect(result.translationSkipped).toBe(true);
    // Only one Ollama call (improve), not two (improve + translate)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should improve and translate when languages differ', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: 'Improved message' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: 'Message traduit' }),
      });

    const result = await processMessage('Test message', 'agent', 'nl', 'fr');
    expect(result.translationSkipped).toBe(false);
    expect(result.fallback).toBe(false);
    expect(result.improvedText).toBe('Improved message');
    expect(result.processedText).toBe('Message traduit');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
