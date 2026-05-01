/**
 * Cross-boundary dependency ports for the message lifecycle.
 *
 * Production adapters in `adapters/` wrap today's concrete services
 * (linkPreview HTTP fetcher, AI translation via AiContext, Moderator).
 * Test adapters in `test/stubs.ts` return canned data deterministically
 * so PGLite boundary tests don't require Redis, an HTTP server, or an
 * AI provider.
 *
 * Storage is intentionally NOT a port — `getStorage()` already returns a
 * stubbable interface. Adding a fourth port would be parallel-pattern noise.
 */

/** Open-graph metadata for a single URL extracted from message text. */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export interface LinkPreviewPort {
  /** Extract OG metadata for URLs in text. Empty array on no URLs / fetch failure. */
  unfurl(text: string): Promise<LinkPreview[]>;
}

export interface AiTranslationPort {
  /**
   * Translate text into the target language under a budget.
   * Returns null on timeout / provider error / disabled feature.
   */
  translate(args: {
    partnerId: string;
    userId: string;
    text: string;
    targetLang: string;
    budgetMs: number;
  }): Promise<string | null>;

  /** Drop cached AI summary for a ticket. Fire-and-forget contract. */
  invalidateSummary(ticketId: string): Promise<void>;
}

// Re-export the moderation contract so messageLifecycle callers don't
// need to know it lives in `services/moderator/`. The Moderator class
// implements ModerationPort directly.
export type {
  GuardCode,
  ModerationContext,
  ModerationPort,
  ModerationResult,
  ModerationScope,
} from '../moderator/index.js';
