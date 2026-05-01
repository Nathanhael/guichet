/**
 * Public surface of the ticket-lifecycle module.
 *
 * Callers (socket handlers, the boot-time reclaim sweep, future tRPC
 * mutations) import only from here. The directory's other files are
 * private internals; the lint rule is "no deep imports".
 *
 * The factory matches the `AiContext` DI precedent: take `{ db }`, return a
 * concrete interface. Wired once at boot in `server/app.ts` and threaded
 * through `HandlerContext` and the boot-time reclaim entry point.
 *
 * PR 1 ships only `reclaim`. Subsequent PRs add `leave`, `returnToQueue`,
 * `assign`, `transfer`, `close`, and `create` to the same interface.
 */
import { runAssign } from './assign.js';
import { runClose } from './close.js';
import { runCreate } from './create.js';
import { runLeave } from './leave.js';
import { runReclaim } from './reclaim.js';
import { runReturnToQueue } from './returnToQueue.js';
import { runTransfer } from './transfer.js';
import type {
  AssignArgs,
  AssignOk,
  CloseArgs,
  CloseOk,
  CreateArgs,
  CreateOk,
  LeaveArgs,
  LeaveOk,
  LifecycleDb,
  ReclaimArgs,
  ReclaimOk,
  Result,
  ReturnToQueueArgs,
  ReturnToQueueOk,
  TicketLifecycle,
  TransferArgs,
  TransferOk,
} from './types.js';

export { applyEffects } from './applyEffects.js';

// Actor builders + types are owned by `services/auth`. Re-exported here as
// the canonical lifecycle public surface; `SYSTEM_ACTOR` is aliased to the
// legacy lowercase `systemActor` name so existing callers continue to
// compile. Deep imports rather than the auth barrel — the barrel
// transitively evaluates `flipIsExternal`'s production wiring (which imports
// `db`), which would force every lifecycle-importing test to mock `db` too.
export { socketActor } from '../auth/actor.js';
export { SYSTEM_ACTOR as systemActor, isUserActor } from '../auth/types.js';
export type { Actor, UserActor, SystemActor } from '../auth/types.js';

// Lifecycle-specific types remain in this directory.
export type {
  AssignArgs,
  AssignOk,
  CloseArgs,
  CloseOk,
  CreateArgs,
  CreateOk,
  Effect,
  LeaveArgs,
  LeaveOk,
  LifecycleDb,
  LifecycleError,
  Participant,
  ReclaimArgs,
  ReclaimOk,
  Result,
  ReturnToQueueArgs,
  ReturnToQueueOk,
  TicketLifecycle,
  TicketReference,
  TransferArgs,
  TransferOk,
} from './types.js';

import type { ModerationPort } from '../moderator/index.js';
import { passingModerator } from '../moderator/test-stubs.js';

/**
 * Cross-boundary ports for the ticket lifecycle. The first one — `moderation`
 * — lands with the moderator deepening (slice 4). Future ports follow the same
 * shape.
 */
export interface TicketLifecyclePorts {
  moderation: ModerationPort;
}

export interface TicketLifecycleDeps {
  db: LifecycleDb;
  /**
   * Optional in tests for backward compat: callers that don't exercise
   * `create.ts` (assign / close / leave / reclaim / returnToQueue / transfer)
   * can omit `ports` and the factory falls back to a passing moderator.
   * Production wiring in `app.ts` always supplies the live moderator.
   */
  ports?: TicketLifecyclePorts;
}

/**
 * Build the lifecycle facade. Each verb is bound to the injected `db` and
 * the per-call partner scope. Tests inject a PGLite-backed db; production
 * injects the node-postgres pool. Same module, same code path.
 */
export function createTicketLifecycle(deps: TicketLifecycleDeps): TicketLifecycle {
  const moderation: ModerationPort = deps.ports?.moderation ?? passingModerator();
  return {
    reclaim: (args: ReclaimArgs): Promise<Result<ReclaimOk>> =>
      runReclaim({ db: deps.db, partnerId: args.partnerId }, args),
    leave: (args: LeaveArgs): Promise<Result<LeaveOk>> =>
      runLeave({ db: deps.db }, args),
    returnToQueue: (args: ReturnToQueueArgs): Promise<Result<ReturnToQueueOk>> =>
      runReturnToQueue({ db: deps.db }, args),
    assign: (args: AssignArgs): Promise<Result<AssignOk>> =>
      runAssign({ db: deps.db }, args),
    transfer: (args: TransferArgs): Promise<Result<TransferOk>> =>
      runTransfer({ db: deps.db }, args),
    close: (args: CloseArgs): Promise<Result<CloseOk>> =>
      runClose({ db: deps.db }, args),
    create: (args: CreateArgs): Promise<Result<CreateOk>> =>
      runCreate({ db: deps.db, moderation }, args),
  };
}
