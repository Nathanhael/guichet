-- Drop the per-user `auth_method` text column.
--
-- Column was only written inside `partner.authMethod === 'both'` branches in the
-- invite flows (platform.users.inviteUser / partner.members.inviteExternalUser).
-- After migration 0008 dropped partners.auth_method + the enum, those branches
-- became dead code and the invite flows were simplified to provision all users
-- password-less (SSO-only). users.auth_method is now orphaned legacy data.
--
-- Data loss is acceptable: column values were never read by the runtime. Take a
-- backup (`npm run db:backup`) before applying on prod.

ALTER TABLE "users" DROP COLUMN IF EXISTS "auth_method";
