-- Partner-level default auth method. Used by the login flow to decide whether
-- to surface SSO, local, or both. Added alongside the Azure B2B guest work in
-- commits 654b372 / 4b24bf3 which wired the platform modal UI around this
-- column without shipping the migration. Backfill is implicit via DEFAULT 'sso'
-- because every live partner is SSO-only today.

DO $$ BEGIN
  CREATE TYPE "auth_method" AS ENUM ('local', 'sso', 'both');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "auth_method" "auth_method" NOT NULL DEFAULT 'sso';
