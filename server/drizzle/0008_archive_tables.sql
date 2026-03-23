-- WORM audit archive with hash chain for tamper detection
CREATE TABLE IF NOT EXISTS "audit_archive" (
  "id" text PRIMARY KEY NOT NULL,
  "action" text NOT NULL,
  "actor_id" text,
  "partner_id" text,
  "target_type" text,
  "target_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL,
  "archived_at" timestamp DEFAULT now() NOT NULL,
  "chain_hash" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_audit_archive_created" ON "audit_archive" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_audit_archive_archived" ON "audit_archive" ("archived_at");
CREATE INDEX IF NOT EXISTS "idx_audit_archive_partner" ON "audit_archive" ("partner_id");

-- Archived tickets — summary records kept after GDPR purge
CREATE TABLE IF NOT EXISTS "archived_tickets" (
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

CREATE INDEX IF NOT EXISTS "idx_archived_tickets_partner" ON "archived_tickets" ("partner_id");
CREATE INDEX IF NOT EXISTS "idx_archived_tickets_created" ON "archived_tickets" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_archived_tickets_archived" ON "archived_tickets" ("archived_at");
