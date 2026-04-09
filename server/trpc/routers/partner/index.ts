import { router } from '../../trpc.js';
import { partnerConfigRouter } from './config.js';
import { partnerMembersRouter } from './members.js';

// Re-export schemas used by test files
export { validatedBusinessHoursScheduleSchema } from './config.js';

export const partnerRouter = router({
  ...partnerConfigRouter._def.procedures,
  ...partnerMembersRouter._def.procedures,
});
