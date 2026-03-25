ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_token" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_expires" timestamp;
