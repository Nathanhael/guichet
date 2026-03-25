DO $$ BEGIN
  CREATE TYPE "public"."auth_method" AS ENUM('local', 'sso', 'both');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "auth_method" "auth_method" NOT NULL DEFAULT 'local';
