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
import { mfaRouter } from './routers/mfa.js';
import { cannedResponseRouter } from './routers/cannedResponse.js';
import { kbRouter } from './routers/kb.js';
import { webhookRouter } from './routers/webhook.js';
import { aiRouter } from './routers/ai.js';

export const appRouter = router({
  ai: aiRouter,
  cannedResponse: cannedResponseRouter,
  kb: kbRouter,
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
  mfa: mfaRouter,
  webhook: webhookRouter,
});

export type AppRouter = typeof appRouter;
