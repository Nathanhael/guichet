-- Feature 11: Flexible Auth — SSO + Local Per User
-- Allow partners to support both local and SSO auth simultaneously
-- Allow per-user auth method override

-- Add 'both' to the existing auth_method enum
ALTER TYPE auth_method ADD VALUE IF NOT EXISTS 'both';

-- Add per-user auth method preference (nullable — null means use partner default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_method text;
