/**
 * Public types for the message-lifecycle module.
 *
 * Callers (socket handlers today, future tRPC mutations tomorrow) import only
 * from `index.ts`. The directory's other files are private internals; the
 * lint rule is "no deep imports".
 *
 * NOTE: this module deliberately diverges from `ticketLifecycle` on one axis:
 * there is no `db.transaction(...)` wrapper. Single-statement writes are
 * atomic by definition and there is no audit invariant that would require
 * multi-write atomicity. The SLA first-staff-response stamp runs synchronously
 * inside `send` in a try/catch and is non-fatal, preserving today's behavior.
 *
 * The `Effect` and `Actor` types + the `applyEffects` dispatcher are reused
 * from `ticketLifecycle`. Acknowledged smell: ticketLifecycle/types.ts owns
 * message-named effect variants. Acceptable cost; if a third lifecycle ever
 * lands, promote shared bits to `services/lifecycle/` then.
 */
import type { LifecycleDb, UserActor, Effect } from '../ticketLifecycle/index.js';

import type {
  AiTranslationPort,
  LinkPreviewPort,
  ModerationPort,
} from './ports.js';

/**
 * Storage interface used by `delete` for fire-and-forget blob cleanup. The
 * existing `getStorage()` interface satisfies this shape — no new port.
 */
export interface MessageLifecycleStorage {
  delete(filename: string): Promise<void>;
}

export interface MessageLifecyclePorts {
  linkPreview: LinkPreviewPort;
  aiTranslation: AiTranslationPort;
  /**
   * Unified content moderator. Owns guard order + per-scope dispatch +
   * multi-trigger reporting + original-text preservation. Consumed by
   * `send.ts` (scope='message:send') and `edit.ts` (scope='message:edit').
   */
  moderation: ModerationPort;
}

export interface MessageLifecycleDeps {
  db: LifecycleDb;
  ports: MessageLifecyclePorts;
  storage: MessageLifecycleStorage;
}

/**
 * Discriminated rejection codes. Separate from `LifecycleError` because the
 * exhaustive-switch at every call site should stay domain-scoped — message
 * codes don't overlap with ticket codes meaningfully.
 */
export type MessageLifecycleError =
  /** Ticket id does not exist, or actor's partner cannot see it. */
  | 'TICKET_NOT_FOUND'
  /** Ticket is in `status='closed'` — send/edit/delete/react not allowed. */
  | 'TICKET_CLOSED'
  /** Actor is not authorized for this op (wrong role, wrong partner). */
  | 'NOT_AUTHORIZED'
  /** Message id does not exist within the given ticket. */
  | 'MESSAGE_NOT_FOUND'
  /** Edit/delete by a non-owner non-staff actor. */
  | 'NOT_OWN_MESSAGE'
  /** Editing a message older than `MAX_EDIT_WINDOW_MS`. */
  | 'EDIT_WINDOW_EXPIRED'
  /** Edit/delete/react attempted on a system message. */
  | 'CANNOT_MUTATE_SYSTEM'
  /** Edit/delete/react attempted on a soft-deleted tombstone. */
  | 'CANNOT_MUTATE_DELETED'
  /** Reaction emoji is not in the allowed `REACTION_EMOJIS` set. */
  | 'INVALID_REACTION'
  /** Send: message has no text, mediaUrl, or attachments. */
  | 'EMPTY_MESSAGE'
  /** Send: mediaUrl failed `isValidMediaUrl()`. */
  | 'INVALID_MEDIA_URL'
  /** Send/edit: content guard pipeline rejected the message. */
  | 'GUARD_REJECTED';

/** Re-exported for external callers — see `ticketLifecycle.Result`. */
export type { Result } from '../ticketLifecycle/index.js';

// ─── React verb ───────────────────────────────────────────────────────────

export interface ReactArgs {
  ticketId: string;
  partnerId: string;
  messageId: string;
  actor: UserActor;
  emoji: string;
}

export interface ReactOk {
  messageId: string;
  /** Reactions JSONB after toggle. Keyed by emoji, value = list of userIds. */
  reactions: Record<string, string[]>;
}

// ─── Send verb ────────────────────────────────────────────────────────────

export interface MessageAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface SendArgs {
  ticketId: string;
  partnerId: string;
  actor: UserActor;
  /** Message text. Empty/whitespace allowed only if mediaUrl or attachments present. */
  text?: string;
  mediaUrl?: string;
  attachments?: MessageAttachment[];
  /** Caller hint — clamped to false for non-support actors (silent + warn). */
  whisper?: boolean;
  replyToId?: string | null;
  /** Client-generated id echoed back in the broadcast for optimistic reconciliation. */
  localId?: string;
  /**
   * Languages of currently-watching viewers in the ticket room (excluding
   * the sender). Used to decide which translations to prewarm. Caller
   * collects these from socket.io's local node iteration.
   */
  viewerLangs?: Set<string>;
}

/**
 * Socket-ready message shape returned by `send` so the dispatcher can
 * broadcast it without a re-read. Mirrors the legacy `insertMessage`
 * return value field-for-field.
 */
export interface SendMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  senderIsExternal: boolean;
  text: string;
  originalText: string;
  mediaUrl?: string;
  attachments?: MessageAttachment[] | null;
  whisper: boolean;
  system: boolean;
  timestamp: string;
  createdAt: string;
  reactions: Record<string, never>;
  replyToId: string | null;
  /** Reply snippet (when replyToId is set + the referenced message exists). */
  replyTo?: { id: string; senderName: string; text: string; mediaUrl: string | null } | null;
  /** Cross-language prewarm translations keyed by language code. */
  translations?: Record<string, string>;
  /** Echoed for optimistic-UI reconciliation when the caller passed it. */
  localId?: string;
}

export interface SendOk {
  message: SendMessage;
  /** True iff the message was sent as a staff-only whisper. */
  isWhisper: boolean;
}

// ─── Delete verb ──────────────────────────────────────────────────────────

export interface DeleteArgs {
  ticketId: string;
  partnerId: string;
  messageId: string;
  actor: UserActor;
}

export interface DeleteOk {
  messageId: string;
  /** ISO timestamp of the soft-delete. */
  deletedAt: string;
}

// ─── Edit verb ────────────────────────────────────────────────────────────

export interface EditArgs {
  ticketId: string;
  partnerId: string;
  messageId: string;
  actor: UserActor;
  newText: string;
}

export interface EditOk {
  messageId: string;
  /** Final text after sync-guard normalization (e.g. trim). */
  text: string;
  /** ISO timestamp of the edit. */
  editedAt: string;
}

// ─── Public lifecycle interface ───────────────────────────────────────────

export interface MessageLifecycle {
  /**
   * Toggle a user's reaction on a message. Validates emoji against the
   * allowed set, rejects system messages and deleted tombstones, and emits
   * the updated reactions map to the ticket room.
   */
  react(args: ReactArgs): Promise<MessageLifecycleResult<ReactOk>>;

  /**
   * Update a message's text. Restricted to own-message within the
   * `MAX_EDIT_WINDOW_MS` window; runs the sync content-guard pipeline
   * (fail-closed) and the Redis-backed repetition guard via the
   * `RepetitionGuardPort` (fail-open on port error). Emits
   * `message:edited` and `notifyPreviewers`.
   */
  edit(args: EditArgs): Promise<MessageLifecycleResult<EditOk>>;

  /**
   * Soft-delete a message. Allowed for staff (support / admin /
   * platform_operator) on any non-system message, or for the message
   * owner. Clears text/mediaUrl/attachments and sets deletedAt. Storage
   * blob cleanup is fire-and-forget AFTER the DB update commits — a
   * storage outage cannot orphan the DB row. Emits `message:deleted`
   * and `notifyPreviewers`.
   */
  delete(args: DeleteArgs): Promise<MessageLifecycleResult<DeleteOk>>;

  /**
   * Insert a new message into the ticket. The most-trafficked verb in the
   * system. Encapsulates the full sender-denorm + content-guard pipeline
   * (sync fail-closed + Redis fail-open) + attachment validation + whisper
   * authz clamp + SLA first-staff-response stamp + reply snippet + AI
   * translation prewarm (raced against 250ms budget) + the broadcast +
   * preview invalidation + summary cache bust + background link unfurl.
   */
  send(args: SendArgs): Promise<MessageLifecycleResult<SendOk>>;
}

/**
 * Local alias — same shape as `ticketLifecycle.Result` but parameterized
 * over `MessageLifecycleError` so the exhaustive switch stays domain-scoped.
 */
export type MessageLifecycleResult<Ok> =
  | { ok: true; data: Ok; effects: Effect[] }
  | { ok: false; code: MessageLifecycleError };

// Re-export Effect for callers
export type { Effect } from '../ticketLifecycle/index.js';
