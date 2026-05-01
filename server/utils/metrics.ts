import client from 'prom-client';

// Collect default Node.js metrics (GC, event loop, memory)
client.collectDefaultMetrics();

// HTTP metrics
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

// Socket.io metrics
export const socketioConnectionsActive = new client.Gauge({
  name: 'socketio_connections_active',
  help: 'Number of active Socket.io connections',
});

export const socketioEventsTotal = new client.Counter({
  name: 'socketio_events_total',
  help: 'Total number of Socket.io events processed',
  labelNames: ['event'],
});

// Ticket metrics
export const ticketsActiveTotal = new client.Gauge({
  name: 'tickets_active_total',
  help: 'Number of currently open or active tickets',
  labelNames: ['partner_id'],
});

export const ticketQueueDepth = new client.Gauge({
  name: 'ticket_queue_depth',
  help: 'Number of tickets waiting for support',
  labelNames: ['partner_id'],
});

// AI pipeline metrics
export const aiPipelineDuration = new client.Histogram({
  name: 'ai_pipeline_duration_seconds',
  help: 'Duration of AI pipeline calls in seconds',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export const aiPipelineErrorsTotal = new client.Counter({
  name: 'ai_pipeline_errors_total',
  help: 'Total number of AI pipeline errors',
  labelNames: ['type'],
});

// Audit-chain integrity. Incremented from the platform audit router whenever
// verifyAuditChain returns a non-valid result. Split by severity so Grafana
// can page on `critical` (actual hash tamper) separately from `warn` (a
// transient service-level failure like a db read timeout).
export const auditChainVerifyFailures = new client.Counter({
  name: 'guichet_audit_chain_verify_failures_total',
  help: 'Chain-integrity verification failures since process start',
  labelNames: ['severity'],
});

// Webhook delivery outcomes. `outcome` is one of:
//   - `2xx` / `3xx` / `4xx` / `5xx` — bucketed response code class
//   - `error` — transport failure (timeout, DNS, SSRF reject, abort)
// `event` is the webhook event name (e.g. ticket.created). Cardinality stays
// bounded because events come from a fixed enum in webhookDispatch.ts.
export const webhookDeliveriesTotal = new client.Counter({
  name: 'guichet_webhook_deliveries_total',
  help: 'Webhook delivery attempts grouped by event and outcome class',
  labelNames: ['event', 'outcome'],
});

export const webhookDeliveryDuration = new client.Histogram({
  name: 'guichet_webhook_delivery_duration_seconds',
  help: 'Webhook delivery wall-clock duration in seconds',
  labelNames: ['event', 'outcome'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

// Ticket lifecycle audit-event counter. Mirrors the rows written by
// services/ticketAudit.ts so Grafana can graph create/close/transfer rates
// without doing an `audit_log` full-scan. `action` cardinality is bounded —
// only the 6 `ticket.*` actions enumerated in PARTNER_ACTIONS are ever
// emitted here.
export const ticketAuditEventsTotal = new client.Counter({
  name: 'guichet_ticket_audit_events_total',
  help: 'Ticket lifecycle audit rows written, grouped by action',
  labelNames: ['action'],
});

// GDPR purge observability. Incremented once per daily purge run in
// services/gdpr.ts. `outcome` is one of:
//   - `success` — purge completed end-to-end (archive + delete + anonymize)
//   - `chain_aborted` — hash chain invalid or unreachable, purge aborted as
//     a precaution to avoid losing evidence before the chain is fixed
//   - `error` — uncaught exception during purge (logged with stack)
// Alerting should fire when `increase(...[48h]) == 0` — a silent purge means
// retention slips and we quietly keep data past the 30d cutoff.
export const gdprPurgeRunsTotal = new client.Counter({
  name: 'guichet_gdpr_purge_runs_total',
  help: 'GDPR daily purge runs, grouped by outcome',
  labelNames: ['outcome'],
});

// Row-level granularity per table. Kept separate from the run counter so that
// a single long-running purge with zero rows (idle tenant) still increments
// the run counter, and a massive retention-window change shows up as a spike
// on this one. `scope` is the data category (messages, tickets, audit_log…).
export const gdprRowsPurgedTotal = new client.Counter({
  name: 'guichet_gdpr_rows_purged_total',
  help: 'Rows removed or anonymized by GDPR purge, grouped by scope',
  labelNames: ['scope'],
});

// SLA metrics
export const slaBreachesTotal = new client.Counter({
  name: 'guichet_sla_breaches_total',
  help: 'Total number of SLA breaches recorded',
  labelNames: ['partner_id', 'department'],
});

export const slaResolutionsTotal = new client.Counter({
  name: 'guichet_sla_resolutions_total',
  help: 'Total number of SLA breaches resolved by staff response',
  labelNames: ['partner_id', 'department'],
});

export const slaSweepRunsTotal = new client.Counter({
  name: 'guichet_sla_sweep_runs_total',
  help: 'Number of SLA sweep runs completed',
});

export const slaSweepDurationSeconds = new client.Histogram({
  name: 'guichet_sla_sweep_duration_seconds',
  help: 'Duration of a single SLA sweep run in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

// Wall-clock minutes between ticket creation and first staff response. UI shows
// business-hours-adjusted time via computeSlaState.met.respondedInMinutes, but
// this histogram stays wall-clock so it's comparable across partners with
// different business-hours schedules.
export const slaFirstResponseMinutes = new client.Histogram({
  name: 'guichet_sla_first_response_minutes',
  help: 'First-response time in wall-clock minutes (ticket created → first staff reply)',
  labelNames: ['partner_id', 'department'],
  buckets: [1, 5, 10, 15, 30, 60, 120, 240, 480],
});

// Language-aware queue routing. Emitted on every support.getStaffingByLanguage
// query (once per poll per connected support session). The imbalance gauge is
// a numeric code (0=ok, 1=thin, 2=critical) so Grafana can page on >=2 for a
// (partner, lang) pair.
export const queueUnclaimedByLang = new client.Gauge({
  name: 'guichet_queue_unclaimed_by_lang',
  help: 'Unclaimed tickets per language, last sampled by the staffing endpoint',
  labelNames: ['partner_id', 'lang'],
});

export const queueOldestUnclaimedSeconds = new client.Gauge({
  name: 'guichet_queue_oldest_unclaimed_seconds',
  help: 'Age in seconds of the oldest unclaimed ticket per language',
  labelNames: ['partner_id', 'lang'],
});

export const queueStaffingImbalance = new client.Gauge({
  name: 'guichet_queue_staffing_imbalance',
  help: 'Imbalance severity per language, coded 0=ok / 1=thin / 2=critical',
  labelNames: ['partner_id', 'lang'],
});

export const crossLangPickupTotal = new client.Counter({
  name: 'guichet_cross_lang_pickup_total',
  help: 'Messages sent by support into a ticket whose agentLang differs from support lang',
  labelNames: ['partner_id', 'support_lang', 'ticket_lang'],
});

// Moderator repetition fail-open counter. Incremented when the RepetitionPort
// throws (e.g. Redis offline) and the Moderator falls back to pass. Lets ops
// distinguish "repetition guard is silently broken" from "repetition guard is
// just not firing". `scope` is one of message:send / message:edit / ticket:create.
export const moderatorRepetitionFailopenTotal = new client.Counter({
  name: 'guichet_moderator_repetition_failopen_total',
  help: 'Number of times moderator repetition check failed open due to port error',
  labelNames: ['scope'],
});

export const register = client.register;
