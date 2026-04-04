CREATE TYPE "public"."alert_status" AS ENUM('active', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."auth_method" AS ENUM('local', 'sso', 'both');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('agent', 'support', 'admin', 'platform_operator');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'pending', 'closed', 'resolved');--> statement-breakpoint
CREATE TABLE "agent_status_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"duration" integer
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text,
	"action" text NOT NULL,
	"template" text NOT NULL,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"user_name" text,
	"role" text,
	"text" text NOT NULL,
	"treated" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archived_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"dept" text NOT NULL,
	"agent_id" text,
	"support_id" text,
	"status" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	"closing_notes" text,
	"reopen_count" integer DEFAULT 0,
	"message_count" integer DEFAULT 0,
	"archived_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_archive" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"partner_id" text,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp NOT NULL,
	"archived_at" timestamp DEFAULT now() NOT NULL,
	"chain_hash" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"partner_id" text,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"dept" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"shortcut" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_agent_status" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"user_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"available_seconds" integer DEFAULT 0 NOT NULL,
	"break_seconds" integer DEFAULT 0 NOT NULL,
	"lunch_seconds" integer DEFAULT 0 NOT NULL,
	"meeting_seconds" integer DEFAULT 0 NOT NULL,
	"training_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"partner_id" text NOT NULL,
	"action" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"avg_latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"dept_counts" jsonb DEFAULT '{}'::jsonb,
	"ratings_by_dept" jsonb DEFAULT '{}'::jsonb,
	"hourly" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "daily_stats_date_partner_id_pk" PRIMARY KEY("date","partner_id")
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"dept" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"slug" text,
	"published" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"role" "user_role" NOT NULL,
	"departments" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text,
	"sender_role" text,
	"sender_lang" text,
	"text" text,
	"media_url" text,
	"whisper" integer DEFAULT 0,
	"system" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"reactions" jsonb DEFAULT '{}'::jsonb,
	"sentiment" real,
	"edited_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "partner_group_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"azure_group_id" text NOT NULL,
	"azure_group_name" text,
	"default_role" "user_role" DEFAULT 'agent' NOT NULL,
	"default_departments" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"industry" text DEFAULT 'general',
	"departments" jsonb DEFAULT '[]'::jsonb,
	"business_hours_schedule" jsonb,
	"business_hours_start" text,
	"business_hours_end" text,
	"business_hours_timezone" text DEFAULT 'Europe/Brussels',
	"status" text DEFAULT 'active' NOT NULL,
	"auth_method" "auth_method" DEFAULT 'local' NOT NULL,
	"sla_config" jsonb DEFAULT '{}'::jsonb,
	"ai_enabled" boolean DEFAULT false,
	"ai_provider" text DEFAULT 'ollama',
	"ai_model" text,
	"ai_config" jsonb DEFAULT '{}'::jsonb,
	"ai_features" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text,
	"ticket_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"support_id" text,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"family" text NOT NULL,
	"partner_id" text,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"references" jsonb DEFAULT '[]'::jsonb,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"support_id" text,
	"support_name" text,
	"support_lang" text,
	"support_joined_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"closing_notes" text,
	"closed_by" text,
	"participants" jsonb DEFAULT '[]'::jsonb,
	"reopened" boolean DEFAULT false,
	"reopen_count" integer DEFAULT 0,
	"sla_response_due_at" timestamp,
	"sla_resolution_due_at" timestamp,
	"sla_breached" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "topic_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"dept" text NOT NULL,
	"topic" text NOT NULL,
	"summary" text NOT NULL,
	"severity" "severity" DEFAULT 'medium',
	"ticket_count" integer NOT NULL,
	"status" "alert_status" DEFAULT 'active',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"external_id" text,
	"name" text NOT NULL,
	"lang" text DEFAULT 'nl',
	"password" text,
	"avatar_url" text,
	"is_platform_operator" boolean DEFAULT false,
	"platform_totp_secret" text,
	"platform_totp_enabled_at" timestamp,
	"reset_password_token" text,
	"reset_password_expires" timestamp,
	"password_changed_at" timestamp,
	"password_history" jsonb DEFAULT '[]'::jsonb,
	"failed_login_attempts" integer DEFAULT 0,
	"locked_until" timestamp,
	"mfa_secret" text,
	"mfa_enabled_at" timestamp,
	"mfa_recovery_codes" jsonb DEFAULT '[]'::jsonb,
	"notification_preferences" jsonb DEFAULT '{}'::jsonb,
	"accessibility_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auth_method" text,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_code" integer,
	"response_body" text,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_status_log" ADD CONSTRAINT "agent_status_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_status_log" ADD CONSTRAINT "agent_status_log_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD CONSTRAINT "app_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD CONSTRAINT "app_feedback_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archived_tickets" ADD CONSTRAINT "archived_tickets_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_agent_status" ADD CONSTRAINT "daily_agent_status_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_agent_status" ADD CONSTRAINT "daily_agent_status_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ai_usage" ADD CONSTRAINT "daily_ai_usage_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_group_mappings" ADD CONSTRAINT "partner_group_mappings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_support_id_users_id_fk" FOREIGN KEY ("support_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_support_id_users_id_fk" FOREIGN KEY ("support_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_alerts" ADD CONSTRAINT "topic_alerts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_status_log_user_partner" ON "agent_status_log" USING btree ("user_id","partner_id");--> statement-breakpoint
CREATE INDEX "idx_agent_status_log_partner_started" ON "agent_status_log" USING btree ("partner_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_agent_status_log_open" ON "agent_status_log" USING btree ("user_id","partner_id") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ai_prompts_partner_action" ON "ai_prompt_templates" USING btree ("partner_id","action");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_partner_created" ON "ai_usage_log" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_user_created" ON "ai_usage_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_app_feedback_partner_id" ON "app_feedback" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_app_feedback_created_at" ON "app_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_archived_tickets_partner" ON "archived_tickets" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_archived_tickets_created" ON "archived_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_archived_tickets_archived" ON "archived_tickets" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "idx_audit_archive_created" ON "audit_archive" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_archive_archived" ON "audit_archive" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "idx_audit_archive_partner" ON "audit_archive" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_audit_archive_sequence" ON "audit_archive" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "idx_audit_log_partner_created" ON "audit_log" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_actor_created" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_log_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_canned_partner" ON "canned_responses" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_canned_shortcut" ON "canned_responses" USING btree ("partner_id","shortcut");--> statement-breakpoint
CREATE INDEX "idx_daily_agent_status_partner_date" ON "daily_agent_status" USING btree ("partner_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_daily_agent_status_unique" ON "daily_agent_status" USING btree ("date","user_id","partner_id");--> statement-breakpoint
CREATE INDEX "idx_daily_ai_usage_partner_date" ON "daily_ai_usage" USING btree ("partner_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_daily_ai_usage_unique" ON "daily_ai_usage" USING btree ("date","partner_id","action","provider","model");--> statement-breakpoint
CREATE INDEX "idx_kb_partner" ON "kb_articles" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_kb_partner_slug" ON "kb_articles" USING btree ("partner_id","slug");--> statement-breakpoint
CREATE INDEX "idx_kb_partner_published" ON "kb_articles" USING btree ("partner_id","published");--> statement-breakpoint
CREATE INDEX "idx_labels_partner_name" ON "labels" USING btree ("partner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_memberships_user_partner" ON "memberships" USING btree ("user_id","partner_id");--> statement-breakpoint
CREATE INDEX "idx_messages_ticket_id" ON "messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_messages_sender_id" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_messages_ticket_deleted" ON "messages" USING btree ("ticket_id","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_messages_ticket_created" ON "messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pgm_partner_group" ON "partner_group_mappings" USING btree ("partner_id","azure_group_id");--> statement-breakpoint
CREATE INDEX "idx_pgm_azure_group" ON "partner_group_mappings" USING btree ("azure_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ratings_ticket_unique" ON "ratings" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_ratings_support_id" ON "ratings" USING btree ("support_id");--> statement-breakpoint
CREATE INDEX "idx_ratings_created_at" ON "ratings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ratings_partner_created" ON "ratings" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens" USING btree ("family");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_saved_views_partner_user" ON "saved_views" USING btree ("partner_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_partner_id" ON "tickets" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_agent_id" ON "tickets" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_status" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tickets_dept" ON "tickets" USING btree ("dept");--> statement-breakpoint
CREATE INDEX "idx_tickets_created_at" ON "tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tickets_partner_created" ON "tickets" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tickets_partner_status" ON "tickets" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "idx_tickets_support_id" ON "tickets" USING btree ("support_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_participants_gin" ON "tickets" USING gin ("participants");--> statement-breakpoint
CREATE INDEX "idx_tickets_open_unassigned" ON "tickets" USING btree ("partner_id","created_at") WHERE status = 'open' AND support_id IS NULL;--> statement-breakpoint
CREATE INDEX "idx_alerts_partner_status" ON "topic_alerts" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_external_id" ON "users" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_logs_webhook_created" ON "webhook_logs" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_webhooks_partner" ON "webhooks" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_webhooks_partner_active" ON "webhooks" USING btree ("partner_id","active");