import { router } from './trpc.js';
import config from '../config.js';
import { labelRouter } from './routers/label.js';
import { ticketRouter } from './routers/ticket.js';
import { messageRouter } from './routers/message.js';
import { presenceRouter } from './routers/presence.js';
import { feedbackRouter } from './routers/feedback.js';
import { ratingRouter } from './routers/rating.js';
import { savedViewRouter } from './routers/savedView.js';
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
import { supportRouter } from './routers/support.js';
import { dashboardRouter } from './routers/dashboard.js';

// Bundle D / RFC #82: testFixtures router exists only outside production. Its
// module-load assert (server/utils/assertNotProduction.ts) throws on import in
// prod, so we must NOT import it statically — a static import would crash the
// prod server on boot. ES2022 top-level await + NodeNext lets us guard the
// import behind the runtime NODE_ENV check.
const testFixturesRouter =
  config.NODE_ENV !== 'production'
    ? (await import('./routers/testFixtures.js')).testFixturesRouter
    : undefined;

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
  support: supportRouter,
  dashboard: dashboardRouter,
  user: userRouter,
  platform: platformRouter,
  partner: partnerRouter,
  alerts: alertsRouter,
  webhook: webhookRouter,
  linkPreview: linkPreviewRouter,
  sla: slaRouter,
  ...(testFixturesRouter ? { testFixtures: testFixturesRouter } : {}),
});

export type AppRouter = typeof appRouter;
