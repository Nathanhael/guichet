/**
 * Production adapters for the three message-lifecycle ports. Each is a thin
 * wrapper around an existing service so the migration is a wiring change
 * rather than a behavior change.
 *
 * Wired in `server/app.ts` alongside `createMessageLifecycle`. Test code
 * imports nothing from here — it uses the in-memory stubs in `../test/stubs.ts`.
 */
import { runAiAction } from '../../ai/runAction.js';
import { unfurlLinks } from '../../linkPreview.js';
import { getModerator } from '../../moderator/instance.js';

import type {
  AiTranslationPort,
  LinkPreviewPort,
  ModerationPort,
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
 * Wraps `runAiAction` for translation. The `budgetMs` parameter is honored
 * at the call-site race in the lifecycle, not inside the adapter —
 * `runAiAction` itself has its own internal timeouts.
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
  };
}

// ─── moderation ──────────────────────────────────────────────────────────

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
