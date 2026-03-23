-- Password policies, account lockout, and MFA columns
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp;
ALTER TABLE "users" ADD COLUMN "password_history" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp;
ALTER TABLE "users" ADD COLUMN "mfa_secret" text;
ALTER TABLE "users" ADD COLUMN "mfa_enabled_at" timestamp;
ALTER TABLE "users" ADD COLUMN "mfa_recovery_codes" jsonb DEFAULT '[]'::jsonb;
