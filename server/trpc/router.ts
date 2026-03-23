import { router } from './trpc.js';
import { labelRouter } from './routers/label.js';
import { ticketRouter } from './routers/ticket.js';
import { messageRouter } from './routers/message.js';
import { presenceRouter } from './routers/presence.js';
import { feedbackRouter } from './routers/feedback.js';
import { ratingRouter } from './routers/rating.js';
import { statsRouter } from './routers/stats.js';
import { userRouter } from './routers/user.js';
import { platformRouter } from './routers/platform.js';
import { platformSecurityRouter } from './routers/platformSecurity.js';
import { partnerRouter } from './routers/partner.js';
import { alertsRouter } from './routers/alerts.js';

export const appRouter = router({
  label: labelRouter,
  ticket: ticketRouter,
  message: messageRouter,
  presence: presenceRouter,
  feedback: feedbackRouter,
  rating: ratingRouter,
  stats: statsRouter,
  user: userRouter,
  platform: platformRouter,
  platformSecurity: platformSecurityRouter,
  partner: partnerRouter,
  alerts: alertsRouter,
});

export type AppRouter = typeof appRouter;
