"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLog = exports.topicAlerts = exports.cannedResponses = exports.dailyStats = exports.ticketLabels = exports.labels = exports.appFeedback = exports.ratings = exports.messages = exports.tickets = exports.memberships = exports.systemSettings = exports.users = exports.partners = exports.authMethodEnum = exports.alertStatusEnum = exports.severityEnum = exports.ticketStatusEnum = exports.roleEnum = void 0;
var pg_core_1 = require("drizzle-orm/pg-core");
// Enums
exports.roleEnum = (0, pg_core_1.pgEnum)('user_role', ['agent', 'support', 'admin', 'platform_operator']);
exports.ticketStatusEnum = (0, pg_core_1.pgEnum)('ticket_status', ['open', 'pending', 'closed', 'resolved']);
exports.severityEnum = (0, pg_core_1.pgEnum)('severity', ['low', 'medium', 'high', 'critical']);
exports.alertStatusEnum = (0, pg_core_1.pgEnum)('alert_status', ['active', 'acknowledged', 'resolved']);
exports.authMethodEnum = (0, pg_core_1.pgEnum)('auth_method', ['local', 'sso']);
exports.partners = (0, pg_core_1.pgTable)('partners', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    name: (0, pg_core_1.text)('name').notNull(),
    logoUrl: (0, pg_core_1.text)('logo_url'),
    industry: (0, pg_core_1.text)('industry').default('general'),
    ref1Label: (0, pg_core_1.text)('ref_1_label').default('Reference 1'),
    ref2Label: (0, pg_core_1.text)('ref_2_label').default('Reference 2'),
    departments: (0, pg_core_1.jsonb)('departments').default([]),
    businessHoursSchedule: (0, pg_core_1.jsonb)('business_hours_schedule'),
    businessHoursStart: (0, pg_core_1.text)('business_hours_start'),
    businessHoursEnd: (0, pg_core_1.text)('business_hours_end'),
    businessHoursTimezone: (0, pg_core_1.text)('business_hours_timezone').default('Europe/Brussels'),
    status: (0, pg_core_1.text)('status').notNull().default('active'),
    authMethod: (0, exports.authMethodEnum)('auth_method').notNull().default('local'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { mode: 'string' }).notNull().defaultNow(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { mode: 'string' }),
});
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    email: (0, pg_core_1.text)('email').unique(), // Azure Identity Prep
    externalId: (0, pg_core_1.text)('external_id').unique(), // Azure OID / Entra ID
    name: (0, pg_core_1.text)('name').notNull(),
    lang: (0, pg_core_1.text)('lang').default('nl'),
    password: (0, pg_core_1.text)('password'), // Optional legacy/local login
    avatarUrl: (0, pg_core_1.text)('avatar_url'),
    isPlatformOperator: (0, pg_core_1.boolean)('is_platform_operator').default(false),
    resetPasswordToken: (0, pg_core_1.text)('reset_password_token'),
    resetPasswordExpires: (0, pg_core_1.timestamp)('reset_password_expires', { mode: 'string' }),
    lastActiveAt: (0, pg_core_1.timestamp)('last_active_at', { mode: 'string' }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { mode: 'string' }).notNull().defaultNow(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { mode: 'string' }),
}, function (table) { return ({
    emailIdx: (0, pg_core_1.index)('idx_users_email').on(table.email),
    externalIdIdx: (0, pg_core_1.index)('idx_users_external_id').on(table.externalId),
}); });
exports.systemSettings = (0, pg_core_1.pgTable)('system_settings', {
    key: (0, pg_core_1.text)('key').primaryKey(),
    value: (0, pg_core_1.jsonb)('value').notNull().default({}),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { mode: 'string' }).notNull().defaultNow(),
});
exports.memberships = (0, pg_core_1.pgTable)('memberships', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    userId: (0, pg_core_1.text)('user_id').notNull().references(function () { return exports.users.id; }, { onDelete: 'cascade' }),
    partnerId: (0, pg_core_1.text)('partner_id').notNull().references(function () { return exports.partners.id; }, { onDelete: 'cascade' }),
    role: (0, exports.roleEnum)('role').notNull(),
    departments: (0, pg_core_1.jsonb)('departments').default([]),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
}, function (table) { return ({
    userPartnerIdx: (0, pg_core_1.uniqueIndex)('idx_memberships_user_partner').on(table.userId, table.partnerId),
}); });
exports.tickets = (0, pg_core_1.pgTable)('tickets', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    partnerId: (0, pg_core_1.text)('partner_id').notNull().references(function () { return exports.partners.id; }, { onDelete: 'cascade' }),
    dept: (0, pg_core_1.text)('dept').notNull(),
    agentId: (0, pg_core_1.text)('agent_id').notNull().references(function () { return exports.users.id; }, { onDelete: 'cascade' }),
    agentName: (0, pg_core_1.text)('agent_name'),
    agentLang: (0, pg_core_1.text)('agent_lang'),
    ref1: (0, pg_core_1.text)('ref_1'),
    ref2: (0, pg_core_1.text)('ref_2'),
    status: (0, exports.ticketStatusEnum)('status').default('open'),
    supportId: (0, pg_core_1.text)('support_id').references(function () { return exports.users.id; }, { onDelete: 'set null' }),
    supportName: (0, pg_core_1.text)('support_name'),
    supportLang: (0, pg_core_1.text)('support_lang'),
    supportJoinedAt: (0, pg_core_1.timestamp)('support_joined_at', { mode: 'string' }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { mode: 'string' }).notNull().defaultNow(),
    closedAt: (0, pg_core_1.timestamp)('closed_at', { mode: 'string' }),
    closingNotes: (0, pg_core_1.text)('closing_notes'),
    closedBy: (0, pg_core_1.text)('closed_by'),
    participants: (0, pg_core_1.jsonb)('participants').default([]),
    reopened: (0, pg_core_1.boolean)('reopened').default(false),
    reopenCount: (0, pg_core_1.integer)('reopen_count').default(0),
}, function (table) { return ({
    partnerIdIdx: (0, pg_core_1.index)('idx_tickets_partner_id').on(table.partnerId),
    agentIdIdx: (0, pg_core_1.index)('idx_tickets_agent_id').on(table.agentId),
    statusIdx: (0, pg_core_1.index)('idx_tickets_status').on(table.status),
    deptIdx: (0, pg_core_1.index)('idx_tickets_dept').on(table.dept),
    createdAtIdx: (0, pg_core_1.index)('idx_tickets_created_at').on(table.createdAt),
    partnerCreatedIdx: (0, pg_core_1.index)('idx_tickets_partner_created').on(table.partnerId, table.createdAt),
    partnerStatusIdx: (0, pg_core_1.index)('idx_tickets_partner_status').on(table.partnerId, table.status),
}); });
exports.messages = (0, pg_core_1.pgTable)('messages', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    ticketId: (0, pg_core_1.text)('ticket_id').notNull().references(function () { return exports.tickets.id; }, { onDelete: 'cascade' }),
    senderId: (0, pg_core_1.text)('sender_id').notNull(),
    senderName: (0, pg_core_1.text)('sender_name'),
    senderRole: (0, pg_core_1.text)('sender_role'),
    senderLang: (0, pg_core_1.text)('sender_lang'),
    text: (0, pg_core_1.text)('text'),
    mediaUrl: (0, pg_core_1.text)('media_url'),
    whisper: (0, pg_core_1.integer)('whisper').default(0),
    system: (0, pg_core_1.integer)('system').default(0),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
    deliveredAt: (0, pg_core_1.timestamp)('delivered_at', { mode: 'string' }),
    readAt: (0, pg_core_1.timestamp)('read_at', { mode: 'string' }),
    reactions: (0, pg_core_1.jsonb)('reactions').default({}),
    sentiment: (0, pg_core_1.real)('sentiment'),
    cannedResponseId: (0, pg_core_1.text)('canned_response_id'),
}, function (table) { return ({
    ticketIdIdx: (0, pg_core_1.index)('idx_messages_ticket_id').on(table.ticketId),
    senderIdIdx: (0, pg_core_1.index)('idx_messages_sender_id').on(table.senderId),
}); });
exports.ratings = (0, pg_core_1.pgTable)('ratings', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    ticketId: (0, pg_core_1.text)('ticket_id').notNull().references(function () { return exports.tickets.id; }, { onDelete: 'cascade' }),
    agentId: (0, pg_core_1.text)('agent_id').notNull().references(function () { return exports.users.id; }, { onDelete: 'cascade' }),
    supportId: (0, pg_core_1.text)('support_id').references(function () { return exports.users.id; }, { onDelete: 'cascade' }),
    rating: (0, pg_core_1.integer)('rating').notNull(),
    comment: (0, pg_core_1.text)('comment'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
});
exports.appFeedback = (0, pg_core_1.pgTable)('app_feedback', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    userId: (0, pg_core_1.text)('user_id').notNull().references(function () { return exports.users.id; }, { onDelete: 'cascade' }),
    userName: (0, pg_core_1.text)('user_name'),
    role: (0, pg_core_1.text)('role'),
    text: (0, pg_core_1.text)('text').notNull(),
    treated: (0, pg_core_1.integer)('treated').default(0),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
});
exports.labels = (0, pg_core_1.pgTable)('labels', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    partnerId: (0, pg_core_1.text)('partner_id').notNull().references(function () { return exports.partners.id; }, { onDelete: 'cascade' }),
    name: (0, pg_core_1.text)('name').notNull(),
    color: (0, pg_core_1.text)('color').notNull(),
}, function (table) { return ({
    partnerNameIdx: (0, pg_core_1.index)('idx_labels_partner_name').on(table.partnerId, table.name),
}); });
exports.ticketLabels = (0, pg_core_1.pgTable)('ticket_labels', {
    ticketId: (0, pg_core_1.text)('ticket_id').notNull().references(function () { return exports.tickets.id; }, { onDelete: 'cascade' }),
    labelId: (0, pg_core_1.text)('label_id').notNull().references(function () { return exports.labels.id; }, { onDelete: 'cascade' }),
}, function (table) { return ({
    pk: (0, pg_core_1.primaryKey)({ columns: [table.ticketId, table.labelId] }),
}); });
exports.dailyStats = (0, pg_core_1.pgTable)('daily_stats', {
    date: (0, pg_core_1.date)('date', { mode: 'string' }).notNull(),
    partnerId: (0, pg_core_1.text)('partner_id').notNull().references(function () { return exports.partners.id; }, { onDelete: 'cascade' }),
    total: (0, pg_core_1.integer)('total').default(0),
    closed: (0, pg_core_1.integer)('closed').default(0),
    abandoned: (0, pg_core_1.integer)('abandoned').default(0),
    avgResponseMs: (0, pg_core_1.integer)('avg_response_ms').default(0),
    avgDurationMs: (0, pg_core_1.integer)('avg_duration_ms').default(0),
    avgRating: (0, pg_core_1.real)('avg_rating'),
    ratingCount: (0, pg_core_1.integer)('rating_count').default(0),
    slaResolved: (0, pg_core_1.integer)('sla_resolved').default(0),
    slaCompliant: (0, pg_core_1.integer)('sla_compliant').default(0),
    p95ResponseMs: (0, pg_core_1.integer)('p95_response_ms').default(0),
    reopened: (0, pg_core_1.integer)('reopened').default(0),
    sentimentSum: (0, pg_core_1.real)('sentiment_sum').default(0),
    sentimentCount: (0, pg_core_1.integer)('sentiment_count').default(0),
    deptCounts: (0, pg_core_1.jsonb)('dept_counts').default({}),
    ratingsByDept: (0, pg_core_1.jsonb)('ratings_by_dept').default({}),
    hourly: (0, pg_core_1.jsonb)('hourly').default({}),
}, function (table) { return ({
    pk: (0, pg_core_1.primaryKey)({ columns: [table.date, table.partnerId] }),
}); });
exports.cannedResponses = (0, pg_core_1.pgTable)('canned_responses', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    partnerId: (0, pg_core_1.text)('partner_id').notNull().references(function () { return exports.partners.id; }, { onDelete: 'cascade' }),
    shortcut: (0, pg_core_1.text)('shortcut').notNull(),
    text: (0, pg_core_1.text)('text').notNull(),
}, function (table) { return ({
    partnerShortcutIdx: (0, pg_core_1.index)('idx_canned_partner_shortcut').on(table.partnerId, table.shortcut),
}); });
exports.topicAlerts = (0, pg_core_1.pgTable)('topic_alerts', {
    id: (0, pg_core_1.text)('id').primaryKey(),
    partnerId: (0, pg_core_1.text)('partner_id').notNull().references(function () { return exports.partners.id; }, { onDelete: 'cascade' }),
    dept: (0, pg_core_1.text)('dept').notNull(),
    topic: (0, pg_core_1.text)('topic').notNull(),
    summary: (0, pg_core_1.text)('summary').notNull(),
    severity: (0, exports.severityEnum)('severity').default('medium'),
    ticketCount: (0, pg_core_1.integer)('ticket_count').notNull(),
    status: (0, exports.alertStatusEnum)('status').default('active'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
    resolvedAt: (0, pg_core_1.timestamp)('resolved_at', { mode: 'string' }),
}, function (table) { return ({
    partnerStatusIdx: (0, pg_core_1.index)('idx_alerts_partner_status').on(table.partnerId, table.status),
}); });
exports.auditLog = (0, pg_core_1.pgTable)('audit_log', {
    id: (0, pg_core_1.text)('id').primaryKey().$defaultFn(function () { return crypto.randomUUID(); }),
    action: (0, pg_core_1.text)('action').notNull(),
    actorId: (0, pg_core_1.text)('actor_id').references(function () { return exports.users.id; }, { onDelete: 'set null' }),
    partnerId: (0, pg_core_1.text)('partner_id').references(function () { return exports.partners.id; }, { onDelete: 'cascade' }),
    targetType: (0, pg_core_1.text)('target_type'),
    targetId: (0, pg_core_1.text)('target_id'),
    metadata: (0, pg_core_1.jsonb)('metadata').default({}),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
}, function (table) { return ({
    partnerCreatedIdx: (0, pg_core_1.index)('idx_audit_log_partner_created').on(table.partnerId, table.createdAt),
    actorCreatedIdx: (0, pg_core_1.index)('idx_audit_log_actor_created').on(table.actorId, table.createdAt),
    actionIdx: (0, pg_core_1.index)('idx_audit_log_action').on(table.action),
}); });
