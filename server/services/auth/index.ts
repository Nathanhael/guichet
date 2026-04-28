export type {
  UserRole,
  Capability,
  UserActor,
  SystemActor,
  Actor,
} from './types.js';

export { SYSTEM_ACTOR, isUserActor } from './types.js';

export { RULES, can, assertCan, CapabilityDeniedError } from './capabilities.js';

export { actorFactory, trpcActor, socketActor } from './actor.js';
