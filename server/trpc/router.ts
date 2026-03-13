import { router } from './trpc.js';
import { labelRouter } from './routers/label.js';
import { cannedResponseRouter } from './routers/cannedResponse.js';
import { ticketRouter } from './routers/ticket.js';
import { messageRouter } from './routers/message.js';
import { presenceRouter } from './routers/presence.js';

export const appRouter = router({
  label: labelRouter,
  cannedResponse: cannedResponseRouter,
  ticket: ticketRouter,
  message: messageRouter,
  presence: presenceRouter,
});

export type AppRouter = typeof appRouter;
