import crypto from 'crypto';
import { pgTable, text, integer, real, primaryKey, index, boolean, timestamp, date, jsonb, pgEnum, uniqueIndex, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** PostgreSQL tsvector column type for full-text search */
const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});

// Enums
export const roleEnum = pgEnum('user_role', ['agent', 'support', 'admin', 'platform_operator']);
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'pending', 'closed', 'resolved']);
export const membershipSourceEnum = pgEnum('membership_source', ['sso', 'manual']);

export const partners = pgTable('partners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  industry: text('industry').default('general'),
  departments: jsonb('departments').default([]),
  businessHoursSchedule: jsonb('business_hours_schedule'),
  status: text('status').notNull().default('active'),
  // AI configuration
  aiEnabled: boolean('ai_enabled').default(false),
  aiProvider: text('ai_provider').default('azure'),
  aiModel: text('ai_model'),
  aiConfig: jsonb('ai_config').default({}),
  aiFeatures: jsonb('ai_features').default({}),
  // Per-partner AI policy overrides. NULL = inherit platform default.
  aiPiiRedaction: text('ai_pii_redaction'),       // 'on' | 'off' | NULL (inherit)
  aiAuditVerbosity: text('ai_audit_verbosity'),   // 'metadata' | 'full' | NULL (inherit)
  // Glossary for translation/improvement (decision 19).
  // Shape: { preserve: string[], forbidden: string[] }
  aiTerms: jsonb('ai_terms').default({}).$type<{ preserve?: string[]; forbidden?: string[] }>(),
  // Per-action custom prompt instructions (decision 23).
  // Shape: { improve?: string; translate?: string }
  aiCustomInstructions: jsonb('ai_custom_instructions').default({}).$type<{
    improve?: string;
    translate?: string;
  }>(),
  // SSO attribute mapping — per-partner IdP claim name overrides. Shape:
  // { locale?: string, firstName?: string, lastName?: string }. Null = use
  // defaults (Entra `preferredLanguage`, `givenName`, `sn`).
  ssoAttributeMap: jsonb('sso_attribute_map').$type<{
    locale?: string;
    firstName?: string;
    lastName?: string;
  } | null>(),
  // Partner-tunable dashboard knobs. Currently:
  //   - ticketsPerStaffPerHour: capacity threshold above which the staffing-fit
  //     zone flags a (dow, hour) cell as understaffed. Default applied at the
  //     read site (5 tickets/h/staff — a chat-support typical with 2-3 parallel
  //     chats). Phone-heavy partners drop it to 1-2; async/email partners can
  //     push it to 10+.
  // Shape kept as JSONB so future dashboard knobs can land without a migration.
  dashboardConfig: jsonb('dashboard_config')
    .$type<{ ticketsPerStaffPerHour?: number }>()
    .notNull()
    .default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(), // Azure Identity Prep
  externalId: text('external_id').unique(), // Azure OID / Entra ID
  name: text('name').notNull(),
  lang: text('lang').default('nl'),
  // When true, SSO login does NOT overwrite `lang` — user's manual choice wins.
  // Set by `trpc.user.setLocale({ lockFromSso: true })`. Cleared by unlock.
  langLocked: boolean('lang_locked').notNull().default(false),
  avatarUrl: text('avatar_url'),
  isPlatformOperator: boolean('is_platform_operator').default(false),
  accessibilityPrefs: jsonb('accessibility_prefs').default({}).notNull().$type<{
    dyslexicMode?: boolean;
    bionicReading?: boolean;
    monochromeMode?: boolean;
    focusMode?: boolean;
  }>(),
  lastActiveAt: timestamp('last_active_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
}, (table) => [
  index('idx_users_email').on(table.email),
  index('idx_users_external_id').on(table.externalId),
]);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull().default({}),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
});

export const memberships = pgTable('memberships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  departments: jsonb('departments').default([]),
  source: membershipSourceEnum('source').notNull().default('sso'),
  // GDPR Art. 21 right-to-object: when true, AI-call log rows for this
  // membership are written with user_id = NULL ("anonymized"). The features
  // themselves remain functional; only the personal traceability is severed.
  // See docs/WORKS_COUNCIL_DISCLOSURE.md §5 and the toggle in UserMenuChip.
  aiOptOut: boolean('ai_opt_out').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_memberships_user_partner').on(table.userId, table.partnerId),
]);

export const tickets = pgTable('tickets', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  dept: text('dept').notNull(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentName: text('agent_name'),
  agentLang: text('agent_lang'),
  references: jsonb('references').$type<Array<{ label: string; value: string }>>().default([]),
  status: ticketStatusEnum('status').notNull().default('open'),
  supportId: text('support_id').references(() => users.id, { onDelete: 'set null' }),
  supportName: text('support_name'),
  supportLang: text('support_lang'),
  supportJoinedAt: timestamp('support_joined_at', { mode: 'string' }),
  firstStaffResponseAt: timestamp('first_staff_response_at', { mode: 'string' }),
  // Bumped to now() every time the ticket (re-)enters a queue: creation,
  // returnTicketToQueue (support:leave / ticketReclaim), and dept transfer.
  // Queue ordering uses this instead of created_at so a customer who got a
  // 30-second support touch and was returned to queue doesn't keep their
  // original head-of-queue position over genuinely fresh tickets.
  queueEnteredAt: timestamp('queue_entered_at', { mode: 'string' }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { mode: 'string' }),
  closingNotes: text('closing_notes'),
  closedBy: text('closed_by'),
  participants: jsonb('participants').$type<Array<{ id: string; name: string; role?: string; lang?: string }>>().default([]),
  reopened: boolean('reopened').default(false),
  reopenCount: integer('reopen_count').default(0),
}, (table) => [
  index('idx_tickets_partner_id').on(table.partnerId),
  index('idx_tickets_agent_id').on(table.agentId),
  index('idx_tickets_status').on(table.status),
  index('idx_tickets_dept').on(table.dept),
  index('idx_tickets_created_at').on(table.createdAt),
  index('idx_tickets_partner_created').on(table.partnerId, table.createdAt),
  index('idx_tickets_partner_closed').on(table.partnerId, table.closedAt),
  index('idx_tickets_partner_status').on(table.partnerId, table.status),
  index('idx_tickets_support_id').on(table.supportId),
  index('idx_tickets_participants_gin').using('gin', table.participants),
  index('idx_tickets_open_unassigned').on(table.partnerId, table.queueEnteredAt).where(sql`status = 'open' AND support_id IS NULL`),
  index('idx_tickets_open_unresponded').on(table.partnerId, table.createdAt).where(sql`status IN ('open','pending') AND first_staff_response_at IS NULL`),
]);

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  // senderId intentionally has no FK — preserves messages after user deletion per GDPR
  senderId: text('sender_id').notNull(),
  senderName: text('sender_name'),
  senderRole: text('sender_role'),
  senderLang: text('sender_lang'),
  text: text('text'),
  mediaUrl: text('media_url'),
  whisper: integer('whisper').default(0),
  system: integer('system').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { mode: 'string' }),
  readAt: timestamp('read_at', { mode: 'string' }),
  reactions: jsonb('reactions').$type<Record<string, string[]>>().default({}),
  editedAt: timestamp('edited_at', { mode: 'string' }),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
  /**
   * Set by AI improve action (slice 7) when the agent applies an AI-improved
   * draft to the outgoing message. Renders the ✨ AI badge next to the
   * timestamp in `Message`. Nullable; null = original human-typed message.
   */
  improvedAt: timestamp('improved_at', { mode: 'string' }),
  linkPreviews: jsonb('link_previews').$type<Array<{ url: string; title?: string; description?: string; image?: string; siteName?: string }>>(),
  attachments: jsonb('attachments').$type<Array<{ url: string; name: string; mimeType: string; size: number }>>(),
  // Self-referencing FK applied at DB level (ALTER TABLE); omit .references() to avoid circular type inference
  replyToId: text('reply_to_id'),
  /** Full-text search vector — populated by DB trigger on INSERT/UPDATE */
  searchVector: tsvector('search_vector'),
}, (table) => [
  index('idx_messages_ticket_id').on(table.ticketId),
  index('idx_messages_sender_id').on(table.senderId),
  index('idx_messages_ticket_deleted').on(table.ticketId, table.deletedAt),
  index('idx_messages_ticket_created').on(table.ticketId, table.createdAt),
  index('idx_messages_reply_to_id').on(table.replyToId),
  index('idx_messages_search_vector').using('gin', table.searchVector),
  // Tenant-isolation gate on the `/uploads` proxy: filename → owning partnerId
  // via `services/uploadOwnership.lookupFilePartnerId`. JSONB containment hits
  // the GIN index; legacy single-image messages use `media_url`.
  index('idx_messages_attachments_gin').using('gin', table.attachments),
  index('idx_messages_media_url').on(table.mediaUrl),
]);

export const ratings = pgTable('ratings', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
  // Ratings outlive tickets: ticket row is purged at 30d (GDPR), scores + attribution
  // stay for long-term trend analysis and agent coaching. Denormalized dept + closedAt
  // let queries work without the ticket row.
  ticketId: text('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
  agentId: text('agent_id').references(() => users.id, { onDelete: 'set null' }),
  supportId: text('support_id').references(() => users.id, { onDelete: 'set null' }),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  dept: text('dept'),
  closedAt: timestamp('closed_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_ratings_ticket_unique').on(table.ticketId),
  index('idx_ratings_support_id').on(table.supportId),
  index('idx_ratings_created_at').on(table.createdAt),
  index('idx_ratings_partner_created').on(table.partnerId, table.createdAt),
]);

export const appFeedback = pgTable('app_feedback', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  userName: text('user_name'),
  role: text('role'),
  text: text('text').notNull(),
  treated: integer('treated').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  // ME-05 fix: Add missing indexes for common query patterns (filter by partner, sort by date)
  index('idx_app_feedback_partner_id').on(table.partnerId),
  index('idx_app_feedback_created_at').on(table.createdAt),
]);

export const labels = pgTable('labels', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
}, (table) => [
  index('idx_labels_partner_name').on(table.partnerId, table.name),
]);

export const ticketLabels = pgTable('ticket_labels', {
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  labelId: text('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.ticketId, table.labelId] }),
]);

export const dailyStats = pgTable('daily_stats', {
  date: date('date', { mode: 'string' }).notNull(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  total: integer('total').default(0),
  closed: integer('closed').default(0),
  abandoned: integer('abandoned').default(0),
  avgResponseMs: integer('avg_response_ms').default(0),
  avgDurationMs: integer('avg_duration_ms').default(0),
  avgRating: real('avg_rating'),
  ratingCount: integer('rating_count').default(0),
  responseCount: integer('response_count').default(0),
  p95ResponseMs: integer('p95_response_ms').default(0),
  reopened: integer('reopened').default(0),
  deptCounts: jsonb('dept_counts').default({}),
  ratingsByDept: jsonb('ratings_by_dept').default({}),
  hourly: jsonb('hourly').default({}),
}, (table) => [
  primaryKey({ columns: [table.date, table.partnerId] }),
]);

export const slaBreaches = pgTable('sla_breaches', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  dept: text('dept').notNull(),
  breachedAt: timestamp('breached_at', { mode: 'string' }).notNull().defaultNow(),
  thresholdMinutes: integer('threshold_minutes').notNull(),
  resolvedAt: timestamp('resolved_at', { mode: 'string' }),
  resolvedReason: text('resolved_reason'), // 'first_response' | 'ticket_closed_without_response'
}, (table) => [
  uniqueIndex('idx_sla_breaches_ticket_unique').on(table.ticketId),
  index('idx_sla_breaches_partner_status').on(table.partnerId, table.resolvedAt),
  index('idx_sla_breaches_breached_at').on(table.breachedAt),
]);

export const partnerGroupMappings = pgTable('partner_group_mappings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  azureGroupId: text('azure_group_id').notNull(),
  azureGroupName: text('azure_group_name'),           // Human-readable label, e.g. "BU-Telecom-Support"
  defaultRole: roleEnum('default_role').notNull().default('agent'),
  defaultDepartments: jsonb('default_departments').default([]),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_pgm_partner_group').on(table.partnerId, table.azureGroupId),
  index('idx_pgm_azure_group').on(table.azureGroupId),
]);

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  action: text('action').notNull(),
  actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
  partnerId: text('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_audit_log_partner_created').on(table.partnerId, table.createdAt),
  index('idx_audit_log_actor_created').on(table.actorId, table.createdAt),
  index('idx_audit_log_action').on(table.action),
  index('idx_audit_log_created_at').on(table.createdAt),
  index('idx_audit_log_target_id').on(table.targetId),
]);

// ─── Canned Responses ────────────────────────────────────────────────────────

export const cannedResponses = pgTable('canned_responses', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  dept: text('dept'),                                  // null = all departments
  title: text('title').notNull(),
  body: text('body').notNull(),
  shortcut: text('shortcut'),                          // e.g. "/greet", "/close"
  // Two-letter language code matching users.lang. The language `body` is written in.
  // Inert until partner enables aiFeatures.cannedTranslation.
  sourceLang: text('source_lang').notNull().default('en'),
  // { "nl": "...", "fr": "...", ... }. The sourceLang entry is intentionally
  // omitted (lives in `body`). `{}` reads as "no translations yet" regardless
  // of feature flag state.
  bodyTranslations: jsonb('body_translations').notNull().default({}).$type<Record<string, string>>(),
  // Per-language stale flags set when `body` is edited; cleared on regenerate.
  // { "nl": true, "fr": true } = both translations need regeneration.
  staleTranslations: jsonb('stale_translations').notNull().default({}).$type<Record<string, boolean>>(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_canned_partner').on(table.partnerId),
  index('idx_canned_shortcut').on(table.partnerId, table.shortcut),
]);

// ─── Archive Tables ──────────────────────────────────────────────────────────

/**
 * WORM audit archive — tamper-evident chain of audit log snapshots.
 * Each row includes a SHA-256 hash linking it to the previous entry,
 * forming a hash chain that detects any retroactive modification.
 */
export const auditArchive = pgTable('audit_archive', {
  id: text('id').primaryKey(),                       // same as original audit_log.id
  action: text('action').notNull(),
  actorId: text('actor_id'),
  partnerId: text('partner_id'),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  archivedAt: timestamp('archived_at', { mode: 'string' }).notNull().defaultNow(),
  chainHash: text('chain_hash').notNull(),           // SHA-256(prev_hash + row_data)
  sequence: integer('sequence').notNull().default(0), // Monotonic ordering for deterministic hash chain
}, (table) => [
  index('idx_audit_archive_created').on(table.createdAt),
  index('idx_audit_archive_archived').on(table.archivedAt),
  index('idx_audit_archive_partner').on(table.partnerId),
  index('idx_audit_archive_target_id').on(table.targetId),
  index('idx_audit_archive_sequence').on(table.sequence),
]);

/**
 * Archived tickets — closed tickets moved here before GDPR purge deletes them.
 * Retains summary data for compliance without keeping PII-heavy messages.
 */
export const archivedTickets = pgTable('archived_tickets', {
  id: text('id').primaryKey(),                       // same as original ticket id
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
  dept: text('dept').notNull(),
  agentId: text('agent_id'),
  supportId: text('support_id'),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  closedAt: timestamp('closed_at', { mode: 'string' }),
  closedBy: text('closed_by'),
  closingNotes: text('closing_notes'),
  reopenCount: integer('reopen_count').default(0),
  messageCount: integer('message_count').default(0),
  references: jsonb('references').$type<Array<{ label: string; value: string }>>().default([]),
  archivedAt: timestamp('archived_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_archived_tickets_partner').on(table.partnerId),
  index('idx_archived_tickets_created').on(table.createdAt),
  index('idx_archived_tickets_archived').on(table.archivedAt),
  index('idx_archived_tickets_references').using('gin', table.references),
]);

// ─── Knowledge Base ─────────────────────────────────────────────────────────

export const kbArticles = pgTable('kb_articles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  dept: text('dept'),                              // null = all departments
  tags: jsonb('tags').default([]),                  // string[] for filtering
  slug: text('slug'),                              // URL-friendly key
  published: boolean('published').notNull().default(true),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_kb_partner').on(table.partnerId),
  uniqueIndex('idx_kb_partner_slug').on(table.partnerId, table.slug),
  index('idx_kb_partner_published').on(table.partnerId, table.published),
]);

// ─── AI Service Tables ──────────────────────────────────────────────────────

export const aiPromptTemplates = pgTable('ai_prompt_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  partnerId: text('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),  // classify, suggest, improve, translate, match_canned
  template: text('template').notNull(),
  model: text('model'),              // override model per action
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_ai_prompts_partner_action').on(table.partnerId, table.action),
]);

export const aiUsageLog = pgTable('ai_usage_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  success: boolean('success').notNull().default(true),
  errorMessage: text('error_message'),
  // Slice 2.5 / 7: holds full prompt+response when partner audit_verbosity = 'full',
  // and side-channels like sentOriginal (decision 30). NULL otherwise.
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_ai_usage_partner_created').on(table.partnerId, table.createdAt),
  index('idx_ai_usage_user_created').on(table.userId, table.createdAt),
]);

/**
 * Daily AI usage aggregates — rolled up from ai_usage_log before purge.
 * Keeps historical usage trends without row-level detail.
 * One row per partner × action × provider × model × day.
 */
export const dailyAiUsage = pgTable('daily_ai_usage', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  date: text('date').notNull(),                    // YYYY-MM-DD
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  totalInputTokens: integer('total_input_tokens').notNull().default(0),
  totalOutputTokens: integer('total_output_tokens').notNull().default(0),
  totalRequests: integer('total_requests').notNull().default(0),
  successCount: integer('success_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  avgLatencyMs: integer('avg_latency_ms'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_daily_ai_usage_partner_date').on(table.partnerId, table.date),
  uniqueIndex('idx_daily_ai_usage_unique').on(table.date, table.partnerId, table.action, table.provider, table.model),
]);

// ─── Agent Status Tracking ──────────────────────────────────────────────────

/**
 * Granular status transition log.
 * Each row = one status period (startedAt → endedAt).
 * endedAt is null for the agent's current status.
 */
export const agentStatusLog = pgTable('agent_status_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { mode: 'string' }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { mode: 'string' }),
  duration: integer('duration'),
}, (table) => [
  index('idx_agent_status_log_user_partner').on(table.userId, table.partnerId),
  index('idx_agent_status_log_partner_started').on(table.partnerId, table.startedAt),
  index('idx_agent_status_log_open').on(table.userId, table.partnerId).where(sql`ended_at IS NULL`),
]);

/**
 * Daily rollup of agent time-in-status.
 * One row per user × partner × day.
 * Aggregated from agent_status_log for fast dashboard queries.
 */
export const dailyAgentStatus = pgTable('daily_agent_status', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  date: text('date').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  onlineSeconds: integer('online_seconds').notNull().default(0),
  awaySeconds: integer('away_seconds').notNull().default(0),
  // 24-element array: seconds the user spent in `online` status during each
  // hour-of-day bucket (UTC). Sum equals onlineSeconds. Powers the per-hour
  // staff coverage cell in the dashboard staffing-fit zone — without it, the
  // dashboard had to broadcast the daily total to every hour of the row.
  hourlyOnlineSeconds: jsonb('hourly_online_seconds')
    .$type<number[]>()
    .notNull()
    .default(sql`'[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb`),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_daily_agent_status_partner_date').on(table.partnerId, table.date),
  uniqueIndex('idx_daily_agent_status_unique').on(table.date, table.userId, table.partnerId),
]);

/**
 * AI feedback — thumbs up/down on AI-generated outputs (improve / translate).
 * Slice 7 (decision 29 + 30): captures user signal so admins can tune prompts and
 * partners can see whether AI suggestions actually shipped to customers.
 *
 * Body fields (`originalText`, `aiOutput`) are persisted ONLY when the partner's
 * audit verbosity is 'full'. When verbosity is 'metadata' (the default), only
 * the rating + comment + linkage are stored — no message bodies. The `userFinalChoice`
 * column reflects whether the user ultimately sent the AI suggestion or reverted
 * to the original; populated via the `markImproveResult` flow.
 */
export const aiFeedback = pgTable('ai_feedback', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),                          // 'improve' | 'translate'
  usageLogId: text('usage_log_id').references(() => aiUsageLog.id, { onDelete: 'set null' }),
  rating: text('rating').notNull(),                          // 'up' | 'down'
  originalText: text('original_text'),                       // only when audit_verbosity = 'full'
  aiOutput: text('ai_output'),                               // only when audit_verbosity = 'full'
  userFinalChoice: text('user_final_choice'),                // 'sent_improved' | 'sent_original' | NULL
  comment: text('comment'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_ai_feedback_partner_created').on(table.partnerId, table.createdAt),
  index('idx_ai_feedback_usage_log').on(table.usageLogId),
]);

// ─── Saved Views ─────────────────────────────────────────────────────────────

export const savedViews = pgTable('saved_views', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_saved_views_partner_user').on(table.partnerId, table.userId),
]);

// ─── Refresh Tokens ─────────────────────────────────────────────────────────

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  family: text('family').notNull(),
  partnerId: text('partner_id'),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  index('idx_refresh_tokens_user').on(table.userId),
  index('idx_refresh_tokens_family').on(table.family),
  uniqueIndex('idx_refresh_tokens_hash').on(table.tokenHash),
]);
