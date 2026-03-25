-- Feature 11: Flexible Auth — SSO + Local Per User
-- Allow partners to support both local and SSO auth simultaneously
-- Allow per-user auth method override

-- Add per-user auth method preference (nullable — null means use partner default)
-- The partner.auth_method column is a text field (not an enum), so 'both' is
-- already a valid value — no type alteration needed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_method text;
