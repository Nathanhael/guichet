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
import { runLeave } from './leave.js';
import { runReclaim } from './reclaim.js';
import { runReturnToQueue } from './returnToQueue.js';
import type {
  AssignArgs,
  AssignOk,
  LeaveArgs,
  LeaveOk,
  LifecycleDb,
  ReclaimArgs,
  ReclaimOk,
  Result,
  ReturnToQueueArgs,
  ReturnToQueueOk,
  TicketLifecycle,
} from './types.js';

export { applyEffects } from './applyEffects.js';
export { socketActor, systemActor, isUserActor } from './actor.js';
export type {
  Actor,
  AssignArgs,
  AssignOk,
  UserActor,
  SystemActor,
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
} from './types.js';

export interface TicketLifecycleDeps {
  db: LifecycleDb;
}

/**
 * Build the lifecycle facade. Each verb is bound to the injected `db` and
 * the per-call partner scope. Tests inject a PGLite-backed db; production
 * injects the node-postgres pool. Same module, same code path.
 */
export function createTicketLifecycle(deps: TicketLifecycleDeps): TicketLifecycle {
  return {
    reclaim: (args: ReclaimArgs): Promise<Result<ReclaimOk>> =>
      runReclaim({ db: deps.db, partnerId: args.partnerId }, args),
    leave: (args: LeaveArgs): Promise<Result<LeaveOk>> =>
      runLeave({ db: deps.db }, args),
    returnToQueue: (args: ReturnToQueueArgs): Promise<Result<ReturnToQueueOk>> =>
      runReturnToQueue({ db: deps.db }, args),
    assign: (args: AssignArgs): Promise<Result<AssignOk>> =>
      runAssign({ db: deps.db }, args),
  };
}
