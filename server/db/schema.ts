import { pgTable, text, integer, real, primaryKey, index, boolean, timestamp, date, jsonb, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';

// Enums
export const roleEnum = pgEnum('user_role', ['agent', 'support', 'admin', 'platform_operator']);
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'pending', 'closed', 'resolved']);
export const severityEnum = pgEnum('severity', ['low', 'medium', 'high', 'critical']);
export const alertStatusEnum = pgEnum('alert_status', ['active', 'acknowledged', 'resolved']);
export const authMethodEnum = pgEnum('auth_method', ['local', 'sso']);

export const partners = pgTable('partners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  industry: text('industry').default('general'),
  departments: jsonb('departments').default([]),
  businessHoursSchedule: jsonb('business_hours_schedule'),
  businessHoursStart: text('business_hours_start'),
  businessHoursEnd: text('business_hours_end'),
  businessHoursTimezone: text('business_hours_timezone').default('Europe/Brussels'),
  status: text('status').notNull().default('active'),
  authMethod: authMethodEnum('auth_method').notNull().default('local'),
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
  password: text('password'), // Optional legacy/local login
  avatarUrl: text('avatar_url'),
  isPlatformOperator: boolean('is_platform_operator').default(false),
  platformTotpSecret: text('platform_totp_secret'),
  platformTotpEnabledAt: timestamp('platform_totp_enabled_at', { mode: 'string' }),
  resetPasswordToken: text('reset_password_token'),
  resetPasswordExpires: timestamp('reset_password_expires', { mode: 'string' }),
  passwordChangedAt: timestamp('password_changed_at', { mode: 'string' }),
  passwordHistory: jsonb('password_history').default([]),
  failedLoginAttempts: integer('failed_login_attempts').default(0),
  lockedUntil: timestamp('locked_until', { mode: 'string' }),
  mfaSecret: text('mfa_secret'),
  mfaEnabledAt: timestamp('mfa_enabled_at', { mode: 'string' }),
  mfaRecoveryCodes: jsonb('mfa_recovery_codes').default([]),
  lastActiveAt: timestamp('last_active_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
}, (table) => ({
  emailIdx: index('idx_users_email').on(table.email),
  externalIdIdx: index('idx_users_external_id').on(table.externalId),
}));

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
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  userPartnerIdx: uniqueIndex('idx_memberships_user_partner').on(table.userId, table.partnerId),
}));

export const tickets = pgTable('tickets', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  dept: text('dept').notNull(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentName: text('agent_name'),
  agentLang: text('agent_lang'),
  references: jsonb('references').default([]),
  status: ticketStatusEnum('status').default('open'),
  supportId: text('support_id').references(() => users.id, { onDelete: 'set null' }),
  supportName: text('support_name'),
  supportLang: text('support_lang'),
  supportJoinedAt: timestamp('support_joined_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { mode: 'string' }),
  closingNotes: text('closing_notes'),
  closedBy: text('closed_by'),
  participants: jsonb('participants').default([]),
  reopened: boolean('reopened').default(false),
  reopenCount: integer('reopen_count').default(0),
}, (table) => ({
  partnerIdIdx: index('idx_tickets_partner_id').on(table.partnerId),
  agentIdIdx: index('idx_tickets_agent_id').on(table.agentId),
  statusIdx: index('idx_tickets_status').on(table.status),
  deptIdx: index('idx_tickets_dept').on(table.dept),
  createdAtIdx: index('idx_tickets_created_at').on(table.createdAt),
  partnerCreatedIdx: index('idx_tickets_partner_created').on(table.partnerId, table.createdAt),
  partnerStatusIdx: index('idx_tickets_partner_status').on(table.partnerId, table.status),
}));

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
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
  reactions: jsonb('reactions').default({}),
  sentiment: real('sentiment'),
}, (table) => ({
  ticketIdIdx: index('idx_messages_ticket_id').on(table.ticketId),
  senderIdIdx: index('idx_messages_sender_id').on(table.senderId),
}));

export const ratings = pgTable('ratings', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  supportId: text('support_id').references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
});

export const appFeedback = pgTable('app_feedback', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userName: text('user_name'),
  role: text('role'),
  text: text('text').notNull(),
  treated: integer('treated').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
});

export const labels = pgTable('labels', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
}, (table) => ({
  partnerNameIdx: index('idx_labels_partner_name').on(table.partnerId, table.name),
}));

export const ticketLabels = pgTable('ticket_labels', {
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  labelId: text('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.labelId] }),
}));

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
  slaResolved: integer('sla_resolved').default(0),
  slaCompliant: integer('sla_compliant').default(0),
  p95ResponseMs: integer('p95_response_ms').default(0),
  reopened: integer('reopened').default(0),
  sentimentSum: real('sentiment_sum').default(0),
  sentimentCount: integer('sentiment_count').default(0),
  deptCounts: jsonb('dept_counts').default({}),
  ratingsByDept: jsonb('ratings_by_dept').default({}),
  hourly: jsonb('hourly').default({}),
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.partnerId] }),
}));

export const topicAlerts = pgTable('topic_alerts', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  dept: text('dept').notNull(),
  topic: text('topic').notNull(),
  summary: text('summary').notNull(),
  severity: severityEnum('severity').default('medium'),
  ticketCount: integer('ticket_count').notNull(),
  status: alertStatusEnum('status').default('active'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { mode: 'string' }),
}, (table) => ({
  partnerStatusIdx: index('idx_alerts_partner_status').on(table.partnerId, table.status),
}));

export const partnerGroupMappings = pgTable('partner_group_mappings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  azureGroupId: text('azure_group_id').notNull(),
  azureGroupName: text('azure_group_name'),           // Human-readable label, e.g. "BU-Telecom-Support"
  defaultRole: roleEnum('default_role').notNull().default('agent'),
  defaultDepartments: jsonb('default_departments').default([]),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  partnerGroupIdx: uniqueIndex('idx_pgm_partner_group').on(table.partnerId, table.azureGroupId),
  groupIdx: index('idx_pgm_azure_group').on(table.azureGroupId),
}));

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  action: text('action').notNull(),
  actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
  partnerId: text('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  partnerCreatedIdx: index('idx_audit_log_partner_created').on(table.partnerId, table.createdAt),
  actorCreatedIdx: index('idx_audit_log_actor_created').on(table.actorId, table.createdAt),
  actionIdx: index('idx_audit_log_action').on(table.action),
}));

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
}, (table) => ({
  createdAtIdx: index('idx_audit_archive_created').on(table.createdAt),
  archivedAtIdx: index('idx_audit_archive_archived').on(table.archivedAt),
  partnerIdx: index('idx_audit_archive_partner').on(table.partnerId),
}));

/**
 * Archived tickets — closed tickets moved here before GDPR purge deletes them.
 * Retains summary data for compliance without keeping PII-heavy messages.
 */
export const archivedTickets = pgTable('archived_tickets', {
  id: text('id').primaryKey(),                       // same as original ticket id
  partnerId: text('partner_id').notNull(),
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
  archivedAt: timestamp('archived_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  partnerIdx: index('idx_archived_tickets_partner').on(table.partnerId),
  createdAtIdx: index('idx_archived_tickets_created').on(table.createdAt),
  archivedAtIdx: index('idx_archived_tickets_archived').on(table.archivedAt),
}));
