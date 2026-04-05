-- Change default authMethod for new partners from 'local' to 'sso'
ALTER TABLE "partners" ALTER COLUMN "auth_method" SET DEFAULT 'sso';

-- Update existing partners using 'local' to 'sso'
UPDATE "partners" SET "auth_method" = 'sso' WHERE "auth_method" = 'local';

-- Update partners using 'both' to 'sso'
UPDATE "partners" SET "auth_method" = 'sso' WHERE "auth_method" = 'both';
