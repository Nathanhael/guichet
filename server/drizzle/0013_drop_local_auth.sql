-- Rip local authentication: SSO (and dev-login in non-prod) is now the only path.
-- Platform operators recover via the break-glass CLI (see docs/BREAK_GLASS_RUNBOOK.md).
ALTER TABLE "users" DROP COLUMN IF EXISTS "password";
ALTER TABLE "users" DROP COLUMN IF EXISTS "platform_totp_secret";
ALTER TABLE "users" DROP COLUMN IF EXISTS "platform_totp_enabled_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_token";
ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_expires";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_changed_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_history";
ALTER TABLE "users" DROP COLUMN IF EXISTS "failed_login_attempts";
ALTER TABLE "users" DROP COLUMN IF EXISTS "locked_until";
ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_secret";
ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_enabled_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_recovery_codes";
