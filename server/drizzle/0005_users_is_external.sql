-- Add users.is_external flag for Azure B2B guest detection.
-- Guests are external partner employees invited into our Azure tenant.
-- Set at SSO callback from `acct === 1` or `idp` claim.
-- Drives: UI GUEST badge + destructiveAdminProcedure blocklist.
-- See docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md.

ALTER TABLE "users" ADD COLUMN "is_external" boolean NOT NULL DEFAULT false;
