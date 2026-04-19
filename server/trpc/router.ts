import { router } from './trpc.js';
import { labelRouter } from './routers/label.js';
import { ticketRouter } from './routers/ticket.js';
import { messageRouter } from './routers/message.js';
import { presenceRouter } from './routers/presence.js';
import { feedbackRouter } from './routers/feedback.js';
import { ratingRouter } from './routers/rating.js';
import { savedViewRouter } from './routers/savedView.js';
import { statsRouter } from './routers/stats.js';
import { userRouter } from './routers/user.js';
import { platformRouter } from './routers/platform/index.js';
import { partnerRouter } from './routers/partner/index.js';
import { alertsRouter } from './routers/alerts.js';
import { cannedResponseRouter } from './routers/cannedResponse.js';
import { kbRouter } from './routers/kb.js';
import { webhookRouter } from './routers/webhook.js';
import { aiRouter } from './routers/ai.js';
import { statusRouter } from './routers/status.js';
import { linkPreviewRouter } from './routers/linkPreview.js';
import { slaRouter } from './routers/sla.js';

export const appRouter = router({
  status: statusRouter,
  ai: aiRouter,
  cannedResponse: cannedResponseRouter,
  kb: kbRouter,
  label: labelRouter,
  ticket: ticketRouter,
  message: messageRouter,
  presence: presenceRouter,
  feedback: feedbackRouter,
  rating: ratingRouter,
  savedView: savedViewRouter,
  stats: statsRouter,
  user: userRouter,
  platform: platformRouter,
  partner: partnerRouter,
  alerts: alertsRouter,
  webhook: webhookRouter,
  linkPreview: linkPreviewRouter,
  sla: slaRouter,
});

export type AppRouter = typeof appRouter;
