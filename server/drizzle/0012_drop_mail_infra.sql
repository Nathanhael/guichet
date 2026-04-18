-- Drop mail infrastructure: notification preferences column + legacy mail_config row.
-- The mail subsystem was removed entirely — partners invite via Entra B2B and
-- platform operators self-serve via DB/CLI.
ALTER TABLE "users" DROP COLUMN IF EXISTS "notification_preferences";
DELETE FROM "system_settings" WHERE "key" = 'mail_config';
