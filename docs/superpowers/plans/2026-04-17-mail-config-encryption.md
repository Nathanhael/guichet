# Plan: Encrypt SMTP / provider credentials in mail_config

**Date**: 2026-04-17
**Finding**: M10 from `docs/superpowers/reviews/2026-04-17-full-review.md`
**Target**: `server/services/mail.ts`, `server/trpc/routers/platform/system.ts`, `server/services/bootstrap.ts`
**Status**: Ready to execute

## Problem

`system_settings.value` for `key = 'mail_config'` stores `smtpPass` and `apiKey` as plaintext strings in a JSONB column. A DB leak or `pg_dump` capture exposes SMTP auth and third-party mail-provider API keys immediately. The AI-key pattern already solves this (AES-256-GCM field encryption via `server/services/encryption.ts`), so the fix is to apply the same primitive to mail config.

## Design

Storage shape changes — swap plaintext field names for `encrypted*` variants following the AI-key convention:

```ts
// Before (plaintext in JSONB)
{ provider, apiKey?, smtpPass?, ... }

// After (ciphertext in JSONB)
{ provider, encryptedApiKey?, encryptedSmtpPass?, ... }
```

Keep the existing `MailConfig` interface (plaintext) as the in-memory runtime shape — decrypt happens in `mail.ts::getConfig()` at send time, same pattern as `ai/factory.ts::getProvider()`.

Add an internal `StoredMailConfig` type that represents the JSONB on-disk shape.

## Changes

### 1. `server/services/mail.ts`
- Import `decrypt` from `./encryption.js`.
- In `getConfig()`:
  - Read `systemSettings` row as `StoredMailConfig`.
  - If `encryptedSmtpPass` → decrypt into returned `MailConfig.smtpPass`.
  - If `encryptedApiKey` → decrypt into returned `MailConfig.apiKey`.
  - **Backward-compat**: if legacy plaintext `smtpPass` / `apiKey` present AND the encrypted variant is absent, use the plaintext value. Next write will upgrade it. Log a warn so ops notice the plaintext row.
  - On decrypt failure: log error, return `null` (fails closed — no mail delivery with an unreadable credential).

### 2. `server/trpc/routers/platform/system.ts`

**`getMailConfig` (client-facing)**:
- Compute `hasSmtpPass` = `(encryptedSmtpPass || smtpPass)` truthy.
- Compute `hasApiKey` = `(encryptedApiKey || apiKey)` truthy.
- Strip every plaintext AND ciphertext field before returning (`encryptedSmtpPass`, `encryptedApiKey`, legacy `smtpPass`, `apiKey` all stripped).

**`updateMailConfig`**:
- Import `encrypt` from `../../../services/encryption.js`.
- If `input.smtpPass` provided: `encrypt(input.smtpPass)` → `encryptedSmtpPass` on stored value. Do NOT store plaintext.
- If `input.smtpPass` omitted AND existing row has `encryptedSmtpPass`: preserve it.
- If `input.smtpPass` omitted AND existing row has plaintext `smtpPass` (legacy): re-encrypt it in-place and drop the plaintext key (lazy upgrade on first write).
- Same rules for `apiKey`.
- Ensure the merged value NEVER contains the plaintext `smtpPass` / `apiKey` keys.

### 3. `server/services/bootstrap.ts` — one-shot upgrade
- After existing bootstrap work, call `upgradeMailConfigEncryption()`.
- If no `FIELD_ENCRYPTION_SECRET` / `AI_KEY_ENCRYPTION_SECRET` set: log info and skip (dev without the secret stays working).
- Read `mail_config`. If `smtpPass` / `apiKey` plaintext keys exist:
  - Encrypt → write back under `encrypted*` names → drop plaintext names (one UPDATE).
  - Insert `system.mail_config_encrypted_upgrade` audit row with counts (no values).

### 4. Tests
- Extend `server/__tests__/services/mailConfigEncryption.test.ts` (new, source-inspection):
  - mail.ts decrypts encrypted fields on read + has backward-compat plaintext fallback.
  - system.ts encrypts plaintext on write, strips plaintext from stored value, preserves encrypted on omit.
  - bootstrap.ts runs upgrade guarded on encryption key presence.
  - `getMailConfig` redacts both encrypted and plaintext fields and computes `has*` from either.
- One round-trip unit test: `encrypt(smtpPass) → decrypt → same string` (already exists in `encryption.test.ts`, just verify I don't break it).

## Non-goals
- Not adding a new column — keep using `systemSettings.value` JSONB.
- Not changing the client UI — the form already sends plaintext on save and never receives it back.
- Not re-encrypting on each read (key-rotation path) — out of scope.
- Not adding a schema migration — JSONB shape is flexible.

## Verification
1. Server typecheck clean.
2. Server test suite: full pass (existing gdpr / mail tests should not regress).
3. Manual smoke: in dev, save an SMTP config via PlatformView, reload, send test email — round-trip works.
4. Confirm stored row contains `encryptedSmtpPass` (base64 blob) and NOT `smtpPass`.
