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
  | 'NOT_AUTHORIZED';

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
 * The union grows per PR as new ops land. PR 1 only needs `emit`.
 */
export type Effect =
  | { type: 'emit'; room: string; event: string; payload: unknown };

/** Result data shape returned by `lifecycle.reclaim()`. */
export interface ReclaimOk {
  ticketId: string;
  partnerId: string;
  previousSupportId: string;
  previousSupportName: string | null;
}

/**
 * Public lifecycle interface. Each PR adds a new verb; PR 1 only exposes
 * `reclaim`. Callers depend on this interface, not on individual functions.
 */
export interface TicketLifecycle {
  /**
   * Returns an abandoned ticket to the queue. Caller pre-filters
   * candidates (offline-at marker, supportJoinedAt fallback) and invokes
   * this once per ticket. The lifecycle:
   *  - atomically clears support assignment (race-guarded by previousSupportId)
   *  - inserts the "Auto-released" system message
   *  - writes a `ticket.reclaimed` audit row (new in this PR)
   * All in one PG transaction. A failure on any insert rolls back the
   * mutation — no partial state.
   */
  reclaim(args: ReclaimArgs): Promise<Result<ReclaimOk>>;
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
