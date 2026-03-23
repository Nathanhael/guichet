# Forgot / Reset Password — Auth Method Gate

**Date:** 2026-03-23
**Status:** Approved

---

## Overview

The forgot-password and reset-password UI flows are already fully implemented inside `LoginView` as internal view modes (`'forgot'` and `'reset'`). The backend endpoints are wired up. The token-from-URL detection is in place.

**The only missing piece:** the "Forgot password?" button is currently rendered unconditionally. It should only be visible when the active partner uses `local` auth. SSO partners do not use passwords.

---

## The authMethod Problem

`LoginView` renders before authentication. There is no pre-login partner selection step — no partner manifest, no URL slug, no pre-auth context. `authMethod` is not available until after a successful login.

**Decision: always show the "Forgot password?" button.**

This is the correct pragmatic choice:
- Showing the button to SSO users is a minor UX imperfection, not a security issue
- The backend already handles it gracefully: if the user has no password (SSO account), the reset email is not actionable
- Hiding it requires adding a new public tRPC pre-login partner query, which is disproportionate for this improvement
- If a pre-login partner context is ever added in the future, the auth-method gate can be trivially added at that point

**This spec is therefore closed with no code change required.**

---

## What Already Exists (for reference)

- `viewMode: 'standard' | 'demo' | 'forgot' | 'reset'` state in `LoginView`
- `handleForgotPassword` — calls `POST /api/v1/auth/forgot-password` with `{ email }`
- `handleResetPassword` — calls `POST /api/v1/auth/reset-password` with `{ token, password }`
- `useEffect` on mount reads `?token=` from URL, sets `viewMode = 'reset'` if present, strips token from URL
- "Forgot password?" button renders inside the `viewMode === 'standard'` block

---

## Reset Link for SSO Users

If an SSO-partner user somehow receives a reset link (e.g., from an old email), clicking it will show the reset form (the `?token=` detection is not gated by `authMethod`). This is acceptable — the backend controls validity, and the token will be invalid or expired since SSO users do not go through the forgot-password flow.

---

## Acceptance Criteria

- [x] "Forgot password?" flow functional for local auth users — already implemented
- [x] Reset link via email lands on reset form — already implemented via `useEffect`
- [ ] Manual smoke test: local auth user can complete full forgot → email → reset flow (requires mail config to be set up in `PlatformSystemSettings`)
