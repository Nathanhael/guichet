/**
 * Public surface of the message-lifecycle module.
 *
 * Callers (socket handlers today, future tRPC mutations tomorrow) import
 * only from here. The directory's other files are private internals.
 *
 * The factory matches the `createTicketLifecycle` precedent: take `{ db,
 * ports, storage }`, return a concrete interface. Wired once at boot in
 * `server/app.ts` and threaded through `HandlerContext.messageLifecycle`.
 *
 * PR 1 ships only `react`. Subsequent PRs add `edit`, `delete`, `send`.
 */
import { runReact } from './react.js';
import type {
  MessageLifecycle,
  MessageLifecycleDeps,
  MessageLifecycleResult,
  ReactArgs,
  ReactOk,
} from './types.js';

export type {
  MessageLifecycle,
  MessageLifecycleDeps,
  MessageLifecycleError,
  MessageLifecyclePorts,
  MessageLifecycleResult,
  MessageLifecycleStorage,
  ReactArgs,
  ReactOk,
} from './types.js';

export type {
  AiTranslationPort,
  LinkPreview,
  LinkPreviewPort,
  RepetitionGuardPort,
  RepetitionGuardResult,
} from './ports.js';

// Re-export the shared lifecycle primitives so callers don't need to know
// they live under ticketLifecycle/.
export { applyEffects, socketActor } from '../ticketLifecycle/index.js';
export type { Actor, Effect, UserActor, Result } from '../ticketLifecycle/index.js';

export function createMessageLifecycle(deps: MessageLifecycleDeps): MessageLifecycle {
  return {
    react: (args: ReactArgs): Promise<MessageLifecycleResult<ReactOk>> =>
      runReact({ db: deps.db }, args),
  };
}
