import { router } from './trpc.js';
import { labelRouter } from './routers/label.js';
import { cannedResponseRouter } from './routers/cannedResponse.js';

export const appRouter = router({
  label: labelRouter,
  cannedResponse: cannedResponseRouter,
});

export type AppRouter = typeof appRouter;
