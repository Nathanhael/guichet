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

export const register = client.register;
