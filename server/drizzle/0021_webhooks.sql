CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" text PRIMARY KEY NOT NULL,
  "partner_id" text NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "webhook_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "webhook_id" text NOT NULL REFERENCES "webhooks"("id") ON DELETE CASCADE,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status_code" integer,
  "response_body" text,
  "error" text,
  "duration_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_webhooks_partner" ON "webhooks" ("partner_id");
CREATE INDEX IF NOT EXISTS "idx_webhooks_partner_active" ON "webhooks" ("partner_id", "active");
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_webhook_created" ON "webhook_logs" ("webhook_id", "created_at");
