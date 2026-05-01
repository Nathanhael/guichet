/**
 * Test stubs for the three message-lifecycle ports + storage. Co-located in
 * the lifecycle directory rather than `server/test/` because they are only
 * consumed by message tests; premature sharing is rejected.
 *
 * Each stub has two flavors:
 *  - A factory returning the bare port shape (default-friendly).
 *  - When state-recording is useful (e.g. `recordingStorage`), the factory
 *    also returns a `Set` / `Map` callers can assert against.
 */
import type {
  AiTranslationPort,
  LinkPreviewPort,
  LinkPreview,
} from '../ports.js';
import type { MessageLifecycleStorage } from '../types.js';

// ─── linkPreview ─────────────────────────────────────────────────────────

export function inMemoryLinkPreview(
  fixtures: Record<string, LinkPreview[]> = {},
): LinkPreviewPort {
  return {
    async unfurl(text: string): Promise<LinkPreview[]> {
      // Match by exact substring — keeps the stub trivially predictable.
      for (const [key, previews] of Object.entries(fixtures)) {
        if (text.includes(key)) return previews;
      }
      return [];
    },
  };
}

// ─── aiTranslation ───────────────────────────────────────────────────────

/**
 * Returns canned translations keyed by `${sourceText}|${targetLang}`.
 * `summaries` is a recording set so tests can assert which ticketIds had
 * their AI summary cache busted.
 */
export interface CannedTranslationHandle {
  port: AiTranslationPort;
  summaries: Set<string>;
}

export function cannedTranslation(
  fixtures: Record<string, string> = {},
): AiTranslationPort & { __summaries: Set<string> } {
  const summaries = new Set<string>();
  const port: AiTranslationPort & { __summaries: Set<string> } = {
    __summaries: summaries,
    async translate(args): Promise<string | null> {
      const key = `${args.text}|${args.targetLang}`;
      return fixtures[key] ?? null;
    },
    async invalidateSummary(ticketId: string): Promise<void> {
      summaries.add(ticketId);
    },
  };
  return port;
}

// ─── moderation ──────────────────────────────────────────────────────────
// Single source of truth: `services/moderator/test-stubs.ts`. Re-exported
// here so existing messageLifecycle tests can keep their import path.

export {
  passingModerator,
  blockingModerator,
  cannedModerator,
} from '../../moderator/test-stubs.js';

// ─── storage ─────────────────────────────────────────────────────────────

/**
 * Recording storage stub. Returns the storage shape plus the underlying
 * `Set` of filenames the lifecycle requested to delete, so `delete` tests
 * can assert blob cleanup happened.
 */
export interface RecordingStorageHandle {
  storage: MessageLifecycleStorage;
  deleted: Set<string>;
}

export function recordingStorage(): RecordingStorageHandle {
  const deleted = new Set<string>();
  return {
    storage: {
      async delete(filename: string): Promise<void> {
        deleted.add(filename);
      },
    },
    deleted,
  };
}
