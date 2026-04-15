# Break-Glass Runbook

## Purpose

This runbook defines how Guichet operators should use and recover break-glass access when normal admin access or SSO is unavailable.

Break-glass access is for emergency platform recovery only. It is not a normal operational path.

## Preconditions

- break-glass accounts must be local Guichet accounts
- passwords must be stored with `Argon2id`
- credentials must be held in approved secure storage
- account ownership must be documented
- every break-glass account must be platform-admin capable only if absolutely required

## When To Use It

Use break-glass only when one of these is true:

- Entra / SSO is unavailable
- all normal platform admins are locked out
- an incident requires immediate platform containment
- session revocation or tenant lockdown must be executed urgently

## Emergency Procedure

1. Confirm normal admin or SSO access is unavailable.
2. Retrieve the break-glass credential through the approved access process.
3. Log into Guichet using the local emergency account.
4. Complete TOTP step-up verification before attempting privileged platform actions.
5. Perform only the minimum required recovery actions.
6. Record:
   - who used the account
   - why it was used
   - start and end time
   - what actions were taken

## Allowed Emergency Actions

- revoke active sessions for compromised users
- enter tenant context for containment or recovery
- restore or reassign platform-admin access
- disable or deconfigure affected SSO mappings if required
- inspect audit history and tenant status

## Required Follow-Up

After any break-glass use:

1. Revoke all sessions for the break-glass account.
2. Rotate the break-glass password.
3. Review audit events for:
   - `platform.enter_partner`
   - `user.sessions_revoked`
   - membership changes
   - tenant lifecycle actions
   - SSO mapping changes
4. Document the incident and recovery timeline.
5. Close the incident only after normal access paths are restored.

## Security Notes

- Redis health matters because session revocation depends on it
- break-glass use should trigger manual review even if all actions look valid
- do not leave break-glass sessions active after recovery

## Platform Administrator Login Access

The platform administrator login link is hidden by default to maintain a clean interface and minimize unnecessary exposure. 

To reveal the **"Platform administrator login"** link on the main SSO login page:
1. Navigate to the standard login screen.
2. **Triple-click** (3 rapid clicks) on the large **"GUICHET"** logo at the top of the login card.
3. The link will appear below the SSO button.
