# Break-Glass Runbook

## Purpose

This runbook defines how Guichet operators recover platform access when Azure
SSO is down or every active platform operator has lost access.

Break-glass is for emergency platform recovery only. It is not a normal
operational path.

## Design

Guichet has no local password login. Authentication is Azure SSO only, plus
a dev-login endpoint that is gated off in production. The break-glass path
mints a short-lived platform-operator JWT directly via a CLI that must be run
on the server host (or inside the server container).

The CLI lives at `server/scripts/break_glass.ts` and produces a `guichet_token`
cookie value. Possession of the server's `JWT_SECRET` is the only credential —
anyone with shell access to the server already has full control, so no
additional local secret is stored.

## Preconditions

- Documented list of users with `is_platform_operator = true` in the database.
- Someone on-call has shell access to the server host (or the container).
- The target email belongs to a platform operator user that is not soft-deleted.

## When To Use It

Use break-glass only when one of these is true:

- Azure Entra / SSO is unavailable.
- Every platform operator has lost access to their Azure account.
- An incident requires immediate platform containment and nobody can SSO in.

## Emergency Procedure

1. Confirm normal SSO access is unavailable for every platform operator.
2. Shell into the server host and run:

   ```bash
   docker compose exec server npx tsx server/scripts/break_glass.ts <operator-email> [ttlMinutes]
   ```

   Default TTL is 15 minutes, max 60. The script prints the raw token.

3. Set the `guichet_token` cookie in your browser for the Guichet host
   (use a cookie-editor extension — browser devtools cannot set `HttpOnly`).
   Also set the `session_expires` companion cookie to the same expiry
   timestamp if you want the UI to show accurate expiry.
4. Reload the app. You are now signed in as the named platform operator.
5. Perform only the minimum required recovery actions.
6. Record:
   - who used break-glass
   - why it was used
   - start and end time
   - what actions were taken

## Allowed Emergency Actions

- Revoke active sessions for compromised users.
- Enter partner context for containment or recovery.
- Reassign platform-operator role on a different user.
- Disable or deconfigure affected SSO group mappings.
- Inspect audit history and tenant status.
- **Revoke an Azure B2B partner guest**: remove the user from the partner's
  Azure security group (soft — takes effect on next login) or delete the
  guest user in Azure AD (hard — takes effect on next token validation).
  For immediate revoke, also call `trpc.user.revokeSessions` to kill any
  active JWT. Background and invite flow in `docs/TENANT_IDENTITY_SPEC.md`.

## Required Follow-Up

After any break-glass use:

1. Sign out (or wait for the short TTL to expire — the token is non-renewable).
2. Review audit events for:
   - `auth.break_glass` (the mint itself)
   - `platform.enter_partner`
   - `user.sessions_revoked`
   - membership changes
   - tenant lifecycle actions
   - SSO mapping changes
   - `sso.guest_multi_partner_rejected` (Azure B2B misconfiguration — a guest was assigned to more than one partner group)
3. If the incident involved a suspected JWT-secret compromise, rotate
   `JWT_SECRET` (this invalidates every session in the platform).
4. Document the incident and recovery timeline.
5. Close the incident only after SSO access is restored.

## Security Notes

- The break-glass CLI writes an `auth.break_glass` entry to `audit_log` on
  every successful mint — review these regularly.
- Tokens are capped at 60 minutes and cannot be refreshed — the operator must
  re-mint if they need more time.
- Redis health matters: session revocation during recovery depends on it.
- Break-glass use should trigger manual review even if every action looks
  valid.
- Never leave a break-glass session active after recovery.
