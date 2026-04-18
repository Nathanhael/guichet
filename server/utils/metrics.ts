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

export const register = client.register;
