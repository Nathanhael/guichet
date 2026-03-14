CREATE TABLE "app_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text,
	"role" text,
	"text" text NOT NULL,
	"treated" integer DEFAULT 0,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"shortcut" text NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"date" date NOT NULL,
	"partner_id" text NOT NULL,
	"total" integer DEFAULT 0,
	"closed" integer DEFAULT 0,
	"abandoned" integer DEFAULT 0,
	"avg_response_ms" integer DEFAULT 0,
	"avg_duration_ms" integer DEFAULT 0,
	"avg_rating" real,
	"rating_count" integer DEFAULT 0,
	"sla_resolved" integer DEFAULT 0,
	"sla_compliant" integer DEFAULT 0,
	"p95_response_ms" integer DEFAULT 0,
	"reopened" integer DEFAULT 0,
	"sentiment_sum" real DEFAULT 0,
	"sentiment_count" integer DEFAULT 0,
	"dept_counts" text,
	"ratings_by_dept" text,
	"hourly" text,
	CONSTRAINT "daily_stats_date_partner_id_pk" PRIMARY KEY("date","partner_id")
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_summaries" (
	"period" text NOT NULL,
	"partner_id" text NOT NULL,
	"sentiment" text,
	"questions" text,
	"summary" text,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "llm_summaries_period_partner_id_pk" PRIMARY KEY("period","partner_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"role" text NOT NULL,
	"dept" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text,
	"text" text,
	"translated_text" text,
	"media_url" text,
	"whisper" integer DEFAULT 0,
	"system" integer DEFAULT 0,
	"created_at" timestamp NOT NULL,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"reactions" text DEFAULT '{}',
	"sentiment" real,
	"canned_response_id" text
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"industry" text DEFAULT 'general',
	"primary_color" text DEFAULT '#a855f7',
	"secondary_color" text DEFAULT '#3b82f6',
	"ref_1_label" text DEFAULT 'Reference 1',
	"ref_2_label" text DEFAULT 'Reference 2',
	"ai_rules" text,
	"agent_prompt_strategy" text,
	"support_prompt_strategy" text,
	"enable_actionable_ai" boolean DEFAULT false,
	"departments" text DEFAULT '[]',
	"ai_enabled" boolean DEFAULT true,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"support_id" text,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_labels" (
	"ticket_id" text NOT NULL,
	"label_id" text NOT NULL,
	CONSTRAINT "ticket_labels_ticket_id_label_id_pk" PRIMARY KEY("ticket_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"dept" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_name" text,
	"agent_lang" text,
	"ref_1" text,
	"ref_2" text,
	"status" text DEFAULT 'open',
	"support_id" text,
	"support_name" text,
	"support_lang" text,
	"support_joined_at" timestamp,
	"created_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"closing_notes" text,
	"closed_by" text,
	"participants" text DEFAULT '[]',
	"summary" text,
	"reopened" boolean DEFAULT false,
	"reopen_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "translations_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"from_lang" text NOT NULL,
	"to_lang" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lang" text DEFAULT 'nl',
	"password" text,
	"avatar_url" text,
	"is_platform_operator" boolean DEFAULT false
);
--> statement-breakpoint
ALTER TABLE "app_feedback" ADD CONSTRAINT "app_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_summaries" ADD CONSTRAINT "llm_summaries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_support_id_users_id_fk" FOREIGN KEY ("support_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_support_id_users_id_fk" FOREIGN KEY ("support_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canned_partner_shortcut" ON "canned_responses" USING btree ("partner_id","shortcut");--> statement-breakpoint
CREATE INDEX "idx_labels_partner_name" ON "labels" USING btree ("partner_id","name");--> statement-breakpoint
CREATE INDEX "idx_memberships_user_partner" ON "memberships" USING btree ("user_id","partner_id");--> statement-breakpoint
CREATE INDEX "idx_messages_ticket_id" ON "messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_messages_sender_id" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_partner_id" ON "tickets" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_agent_id" ON "tickets" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_status" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tickets_dept" ON "tickets" USING btree ("dept");--> statement-breakpoint
CREATE INDEX "idx_tickets_created_at" ON "tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tickets_partner_created" ON "tickets" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tickets_partner_status" ON "tickets" USING btree ("partner_id","status");