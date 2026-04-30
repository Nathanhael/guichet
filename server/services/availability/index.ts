// server/services/availability/index.ts
export { Availability } from './availability.js';
export { initAvailability, getAvailability, __resetAvailabilityForTests } from './context.js';
export type {
  AgentStatus,
  SupportEntry,
  AvailabilitySnapshot,
  DailyStats,
  OnlineUser,
  AttachInput,
  DetachInput,
  DetachResult,
} from './types.js';
export type { LiveStatePort, TransitionLogPort, BroadcastPort, Clock } from './ports.js';
export { RedisLiveState } from './adapters/redisLiveState.js';
export { DrizzleTransitionLog } from './adapters/drizzleTransitionLog.js';
export { SocketIoBroadcast } from './adapters/socketIoBroadcast.js';
