/**
 * Shared numeric limits used by socket handlers and (optionally) client-side validation.
 * Centralised here so UI and backend share the same boundaries.
 */

/** Redis TTL for ticket viewer tracking (seconds). */
export const VIEWER_TTL_SECONDS = 300;

/** Max IDs in a batch message delete request. */
export const MAX_BATCH_DELETE = 100;

/** Max characters for a single chat message body. */
export const MAX_MESSAGE_LENGTH = 10_000;

/** Time window (ms) within which a sent message may be edited (15 min). */
export const MAX_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Max labels that can be attached to a single ticket. */
export const MAX_LABELS_PER_TICKET = 50;

/** Max characters for closing notes and rating comments. */
export const MAX_NOTE_LENGTH = 2_000;

/** Max recent closed tickets fetched during identify reconnect. */
export const RECENT_CLOSED_TICKETS_LIMIT = 100;

/**
 * Features that are built but not yet enabled for production use.
 * Remove a feature name from this array to enable it.
 * Used by featureGate() middleware in trpc.ts to block all procedures.
 */
export type DisabledFeature = 'knowledgeBase' | 'webhooks';
export const DISABLED_FEATURES: readonly DisabledFeature[] = [
  'knowledgeBase',
  'webhooks',
];

/** Fixed emoji set for message reactions */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🎉', '✅'] as const;
export type ReactionEmoji = typeof REACTION_EMOJIS[number];
