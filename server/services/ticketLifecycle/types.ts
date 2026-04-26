/**
 * Public types for the ticket-lifecycle module.
 *
 * Callers (socket handlers, the boot-time reclaim sweep, tomorrow's tRPC
 * mutations) import only from `index.ts`. Internal types stay private to the
 * directory.
 */
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from '../../db/schema.js';

/**
 * Substrate-agnostic Drizzle handle. Production wires the `node-postgres`
 * pool; tests inject a PGLite-backed handle. Both extend the same `PgDatabase`
 * base so the lifecycle module never has to care which one it got.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LifecycleDb = PgDatabase<any, typeof schema, any>;

/**
 * Identity contract for every lifecycle call. Built by transport-specific
 * helpers (`socketActor(socket)`, `trpcActor(ctx)`, or the in-process
 * `systemActor`). The lifecycle never inspects raw transport context —
 * everything it needs to authorize and audit lives on the actor.
 */
export type Actor =
  | UserActor
  | SystemActor;

export interface UserActor {
  kind: 'user';
  id: string;
  name: string;
  role: 'agent' | 'support' | 'admin' | 'platform_operator';
  /** True for support / admin / platform_operator. Cached so call sites don't re-derive. */
  isSupport: boolean;
  /** Azure B2B guest flag. */
  isExternal: boolean;
  lang: string;
  /** Tenant scope. The lifecycle uses this to enforce isolation. */
  partnerId: string;
}

export interface SystemActor {
  kind: 'system';
  id: '__system__';
  name: 'System';
}

/**
 * Discriminated rejection codes. New ops add new codes; the type system
 * forces every call site to handle the union exhaustively.
 */
export type LifecycleError =
  /** Ticket id does not exist, or actor's partner cannot see it. */
  | 'TICKET_NOT_FOUND'
  /** Race: someone else already mutated the ticket between read and write. */
  | 'TICKET_ALREADY_REASSIGNED'
  /** Actor is in the wrong tenant (returned as TICKET_NOT_FOUND to avoid leakage). */
  | 'NOT_AUTHORIZED'
  /** Caller is not listed in `tickets.participants`. */
  | 'NOT_A_PARTICIPANT'
  /** Closed tickets cannot be re-opened by a join — use the reopen flow instead. */
  | 'TICKET_CLOSED'
  /** Department id is not in the partner's `departments` JSONB. */
  | 'DEPARTMENT_NOT_FOUND';

/**
 * Discriminated result. Domain rejections are values, not exceptions, so
 * call sites can `switch` exhaustively. Infra failures (DB down, audit
 * insert errored) still throw — the transaction aborts and the caller sees
 * a thrown error, which is the correct signal at that layer.
 */
export type Result<Ok> =
  | { ok: true; data: Ok; effects: Effect[] }
  | { ok: false; code: LifecycleError };

/**
 * Post-commit side effects. Returned as a transport-neutral array; the
 * caller's `applyEffects(io, effects)` dispatches them. The lifecycle module
 * never imports `socket.io`.
 *
 * The union grows per PR as new ops land. `emit` carries an array of room
 * names so the dispatcher can preserve socket.io's `to(a).to(b).emit(...)`
 * de-duplication semantics — broadcasting twice would double-deliver to
 * sockets that sit in both rooms.
 */
export type Effect =
  | { type: 'emit'; rooms: string[]; event: string; payload: unknown }
  | { type: 'notifyPreviewers'; ticketId: string }
  | { type: 'broadcastQueue'; partnerId: string }
  /** Force every support / admin / platform_operator socket out of the ticket room. */
  | { type: 'evictSupportFromRoom'; ticketId: string };

/** Snapshot of `tickets.participants` JSONB rows. */
export interface Participant {
  id: string;
  name: string;
  role?: string;
  lang?: string;
  isExternal?: boolean;
}

/** Result data shape returned by `lifecycle.reclaim()`. */
export interface ReclaimOk {
  ticketId: string;
  partnerId: string;
  previousSupportId: string;
  previousSupportName: string | null;
}

/**
 * Public lifecycle interface. Each PR adds a new verb; PRs 1–2 expose
 * `reclaim`, `leave`, and `returnToQueue`. Callers depend on this
 * interface, not on individual functions.
 */
export interface TicketLifecycle {
  /**
   * Returns an abandoned ticket to the queue. Caller pre-filters
   * candidates (offline-at marker, supportJoinedAt fallback) and invokes
   * this once per ticket. Atomically clears support assignment, inserts
   * the "Auto-released" system message, writes a `ticket.reclaimed`
   * audit row — all in one transaction.
   */
  reclaim(args: ReclaimArgs): Promise<Result<ReclaimOk>>;

  /**
   * Removes a participant from a ticket. If `clearPrimary` is true, also
   * clears the support assignment (the leaver was the primary, or the
   * stored primary is a ghost). Inserts the "X left the conversation"
   * system message and writes a `ticket.left` audit row — all in one
   * transaction. The audit row closes the silent gap that existed when
   * the support:leave handler hand-rolled the orchestration.
   */
  leave(args: LeaveArgs): Promise<Result<LeaveOk>>;

  /**
   * Atomically returns a ticket to the queue (clears support assignment,
   * sets status='open', bumps queue_entered_at), optionally inserts a
   * system message, and writes a `ticket.returned_to_queue` audit row.
   * Used by transfer-same-department and ghost-heal in support:join
   * (those callers migrate in PR 3 / PR 4).
   */
  returnToQueue(args: ReturnToQueueArgs): Promise<Result<ReturnToQueueOk>>;

  /**
   * Assigns a support agent to a ticket. Atomic COALESCE — the joiner
   * becomes primary only if no support is currently assigned; otherwise
   * they're added as a secondary participant. Optionally clears a
   * "ghost" primary first (race-guarded by `ghostHealPreviousSupportId`).
   * Inserts the "X joined the conversation" system message and writes a
   * `ticket.assigned` audit row — all in one transaction.
   */
  assign(args: AssignArgs): Promise<Result<AssignOk>>;

  /**
   * Transfers a ticket to a different department. Atomic txn:
   * (optional) whisper note, dept update + support clear + status='open'
   * + queue_entered_at bump, system announcement message, and the
   * `ticket.transferred` audit row. Returned effects fan out the ticket
   * + partner room broadcasts and force-evict every support socket from
   * the old ticket room so the next claim can come from the new
   * department.
   *
   * Same-department return-to-queue uses `lifecycle.returnToQueue`
   * directly — no need for a separate verb.
   */
  transfer(args: TransferArgs): Promise<Result<TransferOk>>;
}

export interface ReclaimArgs {
  ticketId: string;
  /** Tenant scope for the audit row + staff-room emit. */
  partnerId: string;
  /** Race guard — only reclaim if `tickets.support_id` still matches. */
  previousSupportId: string;
  /** Used in the system message body. Snapshot from the candidate row. */
  previousSupportName: string | null;
}

export interface LeaveArgs {
  ticketId: string;
  partnerId: string;
  /** The user who is leaving. Must be a participant. */
  actor: UserActor;
  /**
   * Caller-determined: should the support assignment be cleared as part
   * of this leave? True when the leaver is the stored primary, or the
   * stored primary turned out to be a ghost (offline / not in
   * participants). False when another valid support remains primary.
   */
  clearPrimary: boolean;
  /**
   * The stored support_id at the time the caller decided `clearPrimary`.
   * Required when `clearPrimary` is true; used as the race guard on the
   * atomic UPDATE so a concurrent claim can't be clobbered.
   */
  previousSupportId?: string | null;
}

export interface LeaveOk {
  /** Snapshot of participants AFTER the leaver was removed. */
  participants: Participant[];
  /** True iff `clearPrimary` was requested AND the atomic clear updated a row. */
  queueReturned: boolean;
}

export interface ReturnToQueueArgs {
  ticketId: string;
  partnerId: string;
  /** UserActor for transfer-same-dept; SystemActor for ghost-heal. */
  actor: Actor;
  /** Race guard — only clear if `tickets.support_id` still matches. */
  previousSupportId: string;
  /** Optional system-message body. Omit to skip the message. */
  systemMessageText?: string;
}

export interface ReturnToQueueOk {
  ticketId: string;
}

export interface AssignArgs {
  ticketId: string;
  partnerId: string;
  /** The joining support / admin / platform_operator. */
  actor: UserActor;
  /**
   * Per-ticket language for the joining support. Stored on
   * `tickets.support_lang` via COALESCE — already-set lang is preserved
   * when a secondary joins. Comes from the socket payload
   * (`support:join` carries `supportLang`).
   */
  supportLang: string;
  /**
   * When non-null, the lifecycle clears the stored support_id (race-
   * guarded by this id) BEFORE the COALESCE assign. Caller computed
   * the ghost decision via Redis presence check; the lifecycle stays
   * DB-only.
   */
  ghostHealPreviousSupportId?: string | null;
}

export interface AssignOk {
  /** Snapshot of participants AFTER the assign. */
  participants: Participant[];
  /** True iff the joining actor became primary (no prior support_id). */
  becamePrimary: boolean;
  /** True iff the ghost-heal clear actually fired (race-guarded). */
  ghostHealed: boolean;
}

export interface TransferArgs {
  ticketId: string;
  partnerId: string;
  /** Must be a support / admin / platform_operator. */
  actor: UserActor;
  /** Target department id; must exist in `partners.departments`. */
  toDepartmentId: string;
  /** Optional whisper note for the new owner — staff-only context handoff. */
  note?: string;
}

export interface TransferOk {
  fromSupportId: string | null;
  toDepartmentId: string;
  toDepartmentName: string;
}
