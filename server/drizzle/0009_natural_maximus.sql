CREATE TABLE "ai_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"usage_log_id" text,
	"rating" text NOT NULL,
	"original_text" text,
	"ai_output" text,
	"user_final_choice" text,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_usage_log_id_ai_usage_log_id_fk" FOREIGN KEY ("usage_log_id") REFERENCES "public"."ai_usage_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_feedback_partner_created" ON "ai_feedback" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_feedback_usage_log" ON "ai_feedback" USING btree ("usage_log_id");