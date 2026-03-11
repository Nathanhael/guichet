import { pgTable, text, integer, real, primaryKey, index, boolean } from 'drizzle-orm/pg-core';

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
  expertJoinedAt: text('expert_joined_at'),
  createdAt: text('created_at').notNull(),
  closedAt: text('closed_at'),
  closingNotes: text('closing_notes'),
  closedBy: text('closed_by'),
  participants: text('participants').default('[]'),
  summary: text('summary'),
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
  createdAt: text('created_at').notNull(),
  deliveredAt: text('delivered_at'),
  readAt: text('read_at'),
  reactions: text('reactions').default('{}'),
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
  createdAt: text('created_at').notNull(),
});

export const appFeedback = pgTable('app_feedback', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userName: text('user_name'),
  role: text('role'),
  text: text('text').notNull(),
  treated: integer('treated').default(0),
  createdAt: text('created_at').notNull(),
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
  date: text('date').primaryKey(),
  total: integer('total').default(0),
  closed: integer('closed').default(0),
  abandoned: integer('abandoned').default(0),
  avgResponseMs: integer('avg_response_ms').default(0),
  avgDurationMs: integer('avg_duration_ms').default(0),
  avgRating: real('avg_rating'),
  ratingCount: integer('rating_count').default(0),
  slaResolved: integer('sla_resolved').default(0),
  slaCompliant: integer('sla_compliant').default(0),
  deptCounts: text('dept_counts'), // JSON string
  ratingsByDept: text('ratings_by_dept'), // JSON string
  hourly: text('hourly'), // JSON string
});

export const translationsCache = pgTable('translations_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  fromLang: text('from_lang').notNull(),
  toLang: text('to_lang').notNull(),
  createdAt: text('created_at').notNull(),
});

export const llmSummaries = pgTable('llm_summaries', {
  period: text('period').primaryKey(),
  sentiment: text('sentiment'),
  questions: text('questions'), // JSON array
  summary: text('summary'),
  updatedAt: text('updated_at').notNull(),
});

export const cannedResponses = pgTable('canned_responses', {
  id: text('id').primaryKey(),
  shortcut: text('shortcut').notNull().unique(),
  text: text('text').notNull(),
});
