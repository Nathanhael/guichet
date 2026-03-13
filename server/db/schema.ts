import { pgTable, text, integer, real, primaryKey, index, boolean, timestamp, date } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  dept: text('dept'),
  lang: text('lang').default('nl'),
  password: text('password'),
});

export const tickets = pgTable('tickets', {
  id: text('id').primaryKey(),
  dept: text('dept').notNull(),
  agentId: text('agent_id').notNull().references(() => users.id),
  agentName: text('agent_name'),
  agentLang: text('agent_lang'),
  cdbId: text('cdb_id'),
  dareRef: text('dare_ref'),
  status: text('status').default('open'),
  expertId: text('expert_id').references(() => users.id),
  expertName: text('expert_name'),
  expertLang: text('expert_lang'),
  expertJoinedAt: timestamp('expert_joined_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
  closedAt: timestamp('closed_at', { mode: 'string' }),
  closingNotes: text('closing_notes'),
  closedBy: text('closed_by'),
  participants: text('participants').default('[]'),
  summary: text('summary'),
  reopened: boolean('reopened').default(false),
  reopenCount: integer('reopen_count').default(0),
}, (table) => ({
  agentIdIdx: index('idx_tickets_agent_id').on(table.agentId),
  statusIdx: index('idx_tickets_status').on(table.status),
  deptIdx: index('idx_tickets_dept').on(table.dept),
  createdAtIdx: index('idx_tickets_created_at').on(table.createdAt),
}));

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  senderId: text('sender_id').notNull(),
  senderName: text('sender_name'),
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
}));

export const ratings = pgTable('ratings', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expertId: text('expert_id').references(() => users.id, { onDelete: 'cascade' }),
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
  name: text('name').notNull().unique(),
  color: text('color').notNull(),
});

export const ticketLabels = pgTable('ticket_labels', {
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  labelId: text('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.labelId] }),
}));

export const dailyStats = pgTable('daily_stats', {
  date: date('date', { mode: 'string' }).primaryKey(),
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
});

export const translationsCache = pgTable('translations_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  fromLang: text('from_lang').notNull(),
  toLang: text('to_lang').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
});

export const llmSummaries = pgTable('llm_summaries', {
  period: text('period').primaryKey(),
  sentiment: text('sentiment'),
  questions: text('questions'), // JSON array
  summary: text('summary'),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull(),
});

export const cannedResponses = pgTable('canned_responses', {
  id: text('id').primaryKey(),
  shortcut: text('shortcut').notNull().unique(),
  text: text('text').notNull(),
});
