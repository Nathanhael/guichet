CREATE TABLE IF NOT EXISTS "kb_articles" (
  "id" text PRIMARY KEY NOT NULL,
  "partner_id" text NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "dept" text,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "slug" text,
  "published" boolean NOT NULL DEFAULT true,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_kb_partner" ON "kb_articles" ("partner_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_kb_partner_slug" ON "kb_articles" ("partner_id", "slug");
CREATE INDEX IF NOT EXISTS "idx_kb_partner_published" ON "kb_articles" ("partner_id", "published");
