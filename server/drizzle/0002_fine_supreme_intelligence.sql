CREATE TABLE "topic_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"dept" text NOT NULL,
	"topic" text NOT NULL,
	"summary" text NOT NULL,
	"severity" text DEFAULT 'medium',
	"ticket_count" integer NOT NULL,
	"status" text DEFAULT 'active',
	"created_at" timestamp NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "topic_alerts" ADD CONSTRAINT "topic_alerts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_alerts_partner_status" ON "topic_alerts" USING btree ("partner_id","status");