import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they're available in vi.mock factories
const {
  mockUpdate,
  mockIsFeatureEnabled,
  mockGetProvider,
  mockGetPromptTemplate,
  mockInterpolate,
  mockLogUsage,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockGetProvider: vi.fn(),
  mockGetPromptTemplate: vi.fn(),
  mockInterpolate: vi.fn(),
  mockLogUsage: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('../../db/postgres.js', () => ({
  db: {
    update: mockUpdate,
  },
}));

vi.mock('../../db/schema.js', () => ({
  messages: { id: 'id', sentiment: 'sentiment' },
}));

vi.mock('./index.js', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
  getProvider: mockGetProvider,
  getPromptTemplate: mockGetPromptTemplate,
  interpolate: mockInterpolate,
  logUsage: mockLogUsage,
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('../../utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

import { parseSentimentScore, scoreSentiment } from './sentiment.js';

describe('sentiment', () => {
  describe('parseSentimentScore', () => {
    it('parses a simple positive float', () => {
      expect(parseSentimentScore('0.75')).toBe(0.75);
    });

    it('parses a negative float', () => {
      expect(parseSentimentScore('-0.5')).toBe(-0.5);
    });

    it('parses an integer', () => {
      expect(parseSentimentScore('1')).toBe(1.0);
    });

    it('parses zero', () => {
      expect(parseSentimentScore('0')).toBe(0);
    });

    it('clamps values above 1.0', () => {
      expect(parseSentimentScore('1.5')).toBe(1.0);
    });

    it('clamps values below -1.0', () => {
      expect(parseSentimentScore('-2.3')).toBe(-1.0);
    });

    it('extracts number from surrounding text', () => {
      expect(parseSentimentScore('The sentiment score is 0.3.')).toBe(0.3);
    });

    it('returns null for non-numeric response', () => {
      expect(parseSentimentScore('positive')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseSentimentScore('')).toBeNull();
    });

    it('handles whitespace around the number', () => {
      expect(parseSentimentScore('  -0.8  ')).toBe(-0.8);
    });

    it('handles negative one exactly', () => {
      expect(parseSentimentScore('-1.0')).toBe(-1.0);
    });

    it('handles positive one exactly', () => {
      expect(parseSentimentScore('1.0')).toBe(1.0);
    });
  });

  describe('scoreSentiment', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Reset mockUpdate to return a chainable builder
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });
    });

    it('does nothing when feature is disabled', async () => {
      mockIsFeatureEnabled.mockResolvedValue(false);

      await scoreSentiment('partner1', 'user1', 'msg1', 'Hello');

      expect(mockIsFeatureEnabled).toHaveBeenCalledWith('partner1', 'sentimentDetection');
      expect(mockGetProvider).not.toHaveBeenCalled();
    });

    it('does nothing when rate limited', async () => {
      mockIsFeatureEnabled.mockResolvedValue(true);
      mockCheckRateLimit.mockResolvedValue({ allowed: false });

      await scoreSentiment('partner1', 'user1', 'msg1', 'Hello');

      expect(mockGetProvider).not.toHaveBeenCalled();
    });

    it('calls provider and updates DB on success', async () => {
      mockIsFeatureEnabled.mockResolvedValue(true);
      mockCheckRateLimit.mockResolvedValue({ allowed: true });
      mockGetPromptTemplate.mockResolvedValue('Analyze: {{text}}');
      mockInterpolate.mockReturnValue('Analyze: Hello world');
      mockGetProvider.mockResolvedValue({
        name: 'test-provider',
        chat: vi.fn().mockResolvedValue({
          content: '0.6',
          inputTokens: 10,
          outputTokens: 2,
          model: 'test-model',
        }),
      });

      await scoreSentiment('partner1', 'user1', 'msg1', 'Hello world');

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: 'partner1',
          userId: 'user1',
          action: 'sentiment',
          success: true,
        }),
      );
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('never throws even on error', async () => {
      mockIsFeatureEnabled.mockRejectedValue(new Error('DB down'));

      // Should not throw
      await expect(scoreSentiment('partner1', 'user1', 'msg1', 'Hello')).resolves.toBeUndefined();
    });

    it('logs failed usage when response is unparseable', async () => {
      mockIsFeatureEnabled.mockResolvedValue(true);
      mockCheckRateLimit.mockResolvedValue({ allowed: true });
      mockGetPromptTemplate.mockResolvedValue('Analyze: {{text}}');
      mockInterpolate.mockReturnValue('Analyze: Hello');
      mockGetProvider.mockResolvedValue({
        name: 'test-provider',
        chat: vi.fn().mockResolvedValue({
          content: 'I cannot determine sentiment',
          inputTokens: 10,
          outputTokens: 8,
          model: 'test-model',
        }),
      });

      await scoreSentiment('partner1', 'user1', 'msg1', 'Hello');

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: expect.stringContaining('Unparseable'),
        }),
      );
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
