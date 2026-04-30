/**
 * Production adapters for the three message-lifecycle ports. Each is a thin
 * wrapper around an existing service so the migration is a wiring change
 * rather than a behavior change.
 *
 * Wired in `server/app.ts` alongside `createMessageLifecycle`. Test code
 * imports nothing from here — it uses the in-memory stubs in `../test/stubs.ts`.
 */
import { invalidateSummary } from '../../ai/summaryCache.js';
import { runAiAction } from '../../ai/runAction.js';
import { guardRepetition } from '../../guards.js';
import { unfurlLinks } from '../../linkPreview.js';
import { getRedisClients } from '../../../utils/redis.js';

import type {
  AiTranslationPort,
  LinkPreviewPort,
  RepetitionGuardPort,
} from '../ports.js';

// ─── linkPreview ─────────────────────────────────────────────────────────

export function httpLinkPreviewAdapter(): LinkPreviewPort {
  return {
    unfurl: (text: string) => unfurlLinks(text),
  };
}

// ─── aiTranslation ───────────────────────────────────────────────────────

const LANG_LABEL: Record<string, string> = {
  nl: 'Dutch',
  fr: 'French',
  en: 'English',
};

/**
 * Wraps `runAiAction` for translation + the existing `invalidateSummary`
 * Redis-cache helper. The `budgetMs` parameter is honored at the call-site
 * race in the lifecycle, not inside the adapter — `runAiAction` itself
 * has its own internal timeouts.
 */
export function aiTranslationAdapter(): AiTranslationPort {
  return {
    async translate(args) {
      try {
        const label = LANG_LABEL[args.targetLang] ?? args.targetLang;
        const res = await runAiAction({
          partnerId: args.partnerId,
          userId: args.userId,
          feature: 'translation',
          action: 'translate',
          vars: { text: args.text, targetLang: label },
          temperature: 0.3,
          maxTokens: 1024,
        });
        return res.content?.trim() ?? null;
      } catch {
        // Provider error / disabled / rate-limited — caller treats as a
        // skipped prewarm. Lifecycle races against a budget regardless.
        return null;
      }
    },
    invalidateSummary: (ticketId) => invalidateSummary(ticketId),
  };
}

// ─── moderation ──────────────────────────────────────────────────────────

import { getModerator } from '../../moderator/instance.js';
import type { ModerationPort } from '../ports.js';

/**
 * Returns a port that delegates to the boot-time Moderator singleton via
 * the registry. The closure defers `getModerator()` until first use, so
 * the messageLifecycle factory can be constructed at module load (before
 * `setModerator` runs inside `initRedis().then(...)`).
 */
export function moderationAdapter(): ModerationPort {
  return {
    moderate: (text, ctx) => getModerator().moderate(text, ctx),
  };
}

// ─── repetitionGuard ─────────────────────────────────────────────────────

export function redisRepetitionAdapter(): RepetitionGuardPort {
  return {
    async check(args) {
      const { pubClient } = getRedisClients();
      const result = await guardRepetition(
        pubClient as Parameters<typeof guardRepetition>[0],
        args.text,
        args.senderId,
      );
      if (result.ok) return { ok: true };
      // Guard codes from `services/guards.ts` are like `guard_repetition`,
      // `guard_offensive`, etc. Map the repetition-specific code through;
      // anything else is shaped as `flood` for now (caller treats both as
      // a `GUARD_REJECTED` rejection).
      return {
        ok: false,
        code: result.code === 'guard_repetition' ? 'repetition' : 'flood',
      };
    },
  };
}
