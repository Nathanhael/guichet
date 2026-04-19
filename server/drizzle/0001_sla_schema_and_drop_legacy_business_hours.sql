CREATE TABLE "sla_breaches" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"dept" text NOT NULL,
	"breached_at" timestamp DEFAULT now() NOT NULL,
	"threshold_minutes" integer NOT NULL,
	"resolved_at" timestamp,
	"resolved_reason" text
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_staff_response_at" timestamp;--> statement-breakpoint
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sla_breaches_ticket_unique" ON "sla_breaches" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_sla_breaches_partner_status" ON "sla_breaches" USING btree ("partner_id","resolved_at");--> statement-breakpoint
CREATE INDEX "idx_sla_breaches_breached_at" ON "sla_breaches" USING btree ("breached_at");--> statement-breakpoint
CREATE INDEX "idx_tickets_open_unresponded" ON "tickets" USING btree ("partner_id","created_at") WHERE status IN ('open','pending') AND first_staff_response_at IS NULL;--> statement-breakpoint
-- Backfill: materialize business_hours_schedule from legacy start/end/timezone columns
-- before dropping them. Mon-Fri windows open, Sat/Sun closed.
UPDATE "partners"
SET "business_hours_schedule" = jsonb_build_object(
    'version', 1,
    'timezone', COALESCE("business_hours_timezone", 'Europe/Brussels'),
    'weekly', jsonb_build_object(
      'mon', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', "business_hours_start", 'end', "business_hours_end"))),
      'tue', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', "business_hours_start", 'end', "business_hours_end"))),
      'wed', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', "business_hours_start", 'end', "business_hours_end"))),
      'thu', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', "business_hours_start", 'end', "business_hours_end"))),
      'fri', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', "business_hours_start", 'end', "business_hours_end"))),
      'sat', jsonb_build_object('closed', true, 'windows', '[]'::jsonb),
      'sun', jsonb_build_object('closed', true, 'windows', '[]'::jsonb)
    ),
    'exceptions', '[]'::jsonb
  )
WHERE "business_hours_schedule" IS NULL
  AND "business_hours_start" IS NOT NULL
  AND "business_hours_end" IS NOT NULL;--> statement-breakpoint
-- For partners with neither schedule nor legacy values, fall back to 24/7 open.
UPDATE "partners"
SET "business_hours_schedule" = jsonb_build_object(
    'version', 1,
    'timezone', COALESCE("business_hours_timezone", 'Europe/Brussels'),
    'weekly', jsonb_build_object(
      'mon', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', '00:00', 'end', '23:59'))),
      'tue', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', '00:00', 'end', '23:59'))),
      'wed', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', '00:00', 'end', '23:59'))),
      'thu', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', '00:00', 'end', '23:59'))),
      'fri', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', '00:00', 'end', '23:59'))),
      'sat', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', '00:00', 'end', '23:59'))),
      'sun', jsonb_build_object('closed', false, 'windows', jsonb_build_array(jsonb_build_object('start', '00:00', 'end', '23:59')))
    ),
    'exceptions', '[]'::jsonb
  )
WHERE "business_hours_schedule" IS NULL;--> statement-breakpoint
ALTER TABLE "partners" DROP COLUMN "business_hours_start";--> statement-breakpoint
ALTER TABLE "partners" DROP COLUMN "business_hours_end";--> statement-breakpoint
ALTER TABLE "partners" DROP COLUMN "business_hours_timezone";
--> statement-breakpoint
-- Backfill first_staff_response_at for closed tickets only
-- (Open tickets stay NULL so SLA starts tracking fresh on the first live write)
UPDATE tickets t
SET first_staff_response_at = sub.first_response
FROM (
  SELECT m.ticket_id, MIN(m.created_at) AS first_response
  FROM messages m
  JOIN tickets tk ON tk.id = m.ticket_id
  WHERE m.whisper = 0
    AND m.system = 0
    AND m.sender_role IN ('support','admin','platform_operator')
    AND tk.status = 'closed'
  GROUP BY m.ticket_id
) sub
WHERE t.id = sub.ticket_id AND t.status = 'closed';