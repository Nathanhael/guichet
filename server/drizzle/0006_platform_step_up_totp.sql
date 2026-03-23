ALTER TABLE "users" ADD COLUMN "platform_totp_secret" text;
ALTER TABLE "users" ADD COLUMN "platform_totp_enabled_at" timestamp;
