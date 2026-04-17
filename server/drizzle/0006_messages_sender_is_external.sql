-- Add messages.sender_is_external for server-authoritative GUEST-badge rendering.
--
-- Companion to users.is_external (migration 0005). Denormalized at insert time
-- so MessageBubble can render the GUEST marker on historical messages without
-- a live presence lookup. System messages and messages from non-guest users
-- stay at the default false.
--
-- Backfill: apply the current users.is_external flag to existing rows. This
-- is an approximation — a user who is currently a guest is assumed to have
-- been a guest when they sent those older messages too. Accurate enough for
-- UI surfacing; new messages onwards are authoritative via the insert path.
--
-- See docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md.

ALTER TABLE "messages" ADD COLUMN "sender_is_external" boolean NOT NULL DEFAULT false;

UPDATE "messages" m
   SET "sender_is_external" = true
  FROM "users" u
 WHERE u."id" = m."sender_id"
   AND u."is_external" = true;
