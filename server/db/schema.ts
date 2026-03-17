import { pgTable, text, integer, real, primaryKey, index, boolean, timestamp, date } from 'drizzle-orm/pg-core';

export const partners = pgTable('partners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  industry: text('industry').default('general'),
  primaryColor: text('primary_color').default('#007aff'),
  secondaryColor: text('secondary_color').default('#0a84ff'),
  ref1Label: text('ref_1_label').default('Reference 1'),
  ref2Label: text('ref_2_label').default('Reference 2'),
  aiRules: text('ai_rules'),
  agentPromptStrategy: text('agent_prompt_strategy'),
  supportPromptStrategy: text('support_prompt_strategy'),
  enableActionableAi: boolean('enable_actionable_ai').default(false),
  departments: text('departments').default('[]'), // JSON array
  aiEnabled: boolean('ai_enabled').default(false),
  themeConfig: text('theme_config'), // JSONB
  ollamaModel: text('ollama_model'),
  businessHoursStart: text('business_hours_start'),
  businessHoursEnd: text('business_hours_end'),
  businessHoursTimezone: text('business_hours_timezone').default('Europe/Brussels'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  lang: text('lang').default('nl'), // Global preferred language
  password: text('password'),
  avatarUrl: text('avatar_url'),
  isPlatformOperator: boolean('is_platform_operator').default(false),
});

export const memberships = pgTable('memberships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'agent', 'support', 'admin', 'manager'
  dept: text('dept'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
}, (table) => ({
  userPartnerIdx: index('idx_memberships_user_partner').on(table.userId, table.partnerId),
}));

export const tickets = pgTable('tickets', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id),
  dept: text('dept').notNull(),
  agentId: text('agent_id').notNull().references(() => users.id),
  agentName: text('agent_name'),
  agentLang: text('agent_lang'),
  ref1: text('ref_1'), // Genericized from cdb_id
  ref2: text('ref_2'), // Genericized from dare_ref
  status: text('status').default('open'),
  supportId: text('support_id').references(() => users.id),
  supportName: text('support_name'),
  supportLang: text('support_lang'),
  supportJoinedAt: timestamp('support_joined_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  closedAt: timestamp('closed_at', { mode: 'string' }),
  closingNotes: text('closing_notes'),
  closedBy: text('closed_by'),
  participants: text('participants').default('[]'),
  summary: text('summary'),
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
  translatedText: text('translated_text'),
  mediaUrl: text('media_url'),
  whisper: integer('whisper').default(0),
  system: integer('system').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  deliveredAt: timestamp('delivered_at', { mode: 'string' }),
  readAt: timestamp('read_at', { mode: 'string' }),
  reactions: text('reactions').default('{}'),
  sentiment: real('sentiment'),
  cannedResponseId: text('canned_response_id'),
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
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
});

export const appFeedback = pgTable('app_feedback', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userName: text('user_name'),
  role: text('role'),
  text: text('text').notNull(),
  treated: integer('treated').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
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
  deptCounts: text('dept_counts'), // JSON string
  ratingsByDept: text('ratings_by_dept'), // JSON string
  hourly: text('hourly'), // JSON string
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.partnerId] }),
}));

export const translationsCache = pgTable('translations_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  fromLang: text('from_lang').notNull(),
  toLang: text('to_lang').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
});

export const llmSummaries = pgTable('llm_summaries', {
  period: text('period').notNull(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  sentiment: text('sentiment'),
  questions: text('questions'), // JSON array
  summary: text('summary'),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.period, table.partnerId] }),
}));

export const cannedResponses = pgTable('canned_responses', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  shortcut: text('shortcut').notNull(),
  text: text('text').notNull(),
}, (table) => ({
  partnerShortcutIdx: index('idx_canned_partner_shortcut').on(table.partnerId, table.shortcut),
}));

export const topicAlerts = pgTable('topic_alerts', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  dept: text('dept').notNull(),
  topic: text('topic').notNull(),
  summary: text('summary').notNull(),
  severity: text('severity').default('medium'), // 'low', 'medium', 'high'
  ticketCount: integer('ticket_count').notNull(),
  status: text('status').default('active'), // 'active', 'acknowledged', 'resolved'
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  resolvedAt: timestamp('resolved_at', { mode: 'string' }),
}, (table) => ({
  partnerStatusIdx: index('idx_alerts_partner_status').on(table.partnerId, table.status),
}));
