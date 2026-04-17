-- Remove the per-partner auth_method column and the auth_method enum.
-- Partners are SSO-only (SSO config lives in env); per-partner method is dead data.
-- Platform operators still use local auth, gated by users.is_platform_operator — not
-- by any partner flag. users.auth_method (plain text override) is kept for legacy
-- data but no longer written by the invite flows.

ALTER TABLE "partners" DROP COLUMN IF EXISTS "auth_method";
DROP TYPE IF EXISTS "public"."auth_method";
