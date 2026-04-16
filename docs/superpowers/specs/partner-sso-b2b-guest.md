# Partner SSO via Azure B2B Guests — Operations Runbook

**Status:** Shipped
**Plan:** [`../plans/2026-04-16-partner-sso-b2b-guest.md`](../plans/2026-04-16-partner-sso-b2b-guest.md)
**Audience:** Platform operators, Azure tenant admins, partner-facing onboarding

## What this enables

Partner employees (e.g. an engineer at a telecom we're outsourced to) can
log into Guichet using their own Microsoft/Google/Azure identity, and either
help our trained agents as second-line support, or review the partner's
admin panels. They do this without us creating a local account, without
their IT spinning up a new SSO provider, and without us shipping multi-IdP
infrastructure.

Under the hood we piggy-back on Azure B2B guest federation. A partner
employee is invited into **our** Azure tenant as a guest. They authenticate
via their home tenant; Azure vouches for them; our existing SSO callback
sees an Azure token with the `acct=1` claim (or an `idp` claim) and flips
`users.isExternal` on their Guichet row.

## Prerequisites

- Azure tenant admin access (our tenant) for inviting guests and managing
  security groups.
- A partner with `authMethod IN ('sso','both')` and at least one
  `partner_group_mappings` row keyed to an Azure security group you control.
- Partner IT needs to be willing to accept B2B federation. If they refuse,
  this runbook does not apply — revisit per-partner SSO (Option B in the
  original plan doc).

## Invite flow — end to end

### 1. Create per-(partner, role) Azure security groups

For each partner that will have guest helpers, create a security group per
role you want to support. Recommended naming:

```
guichet-<partner-slug>-support        → support role, specific departments
guichet-<partner-slug>-admin          → admin role, all departments
```

Example for a partner "telcoM":

- `guichet-telcoM-support`
- `guichet-telcoM-admin`

### 2. Map groups in Guichet

In PlatformView → SSO Group Mappings, add one row per group:

| Azure Group ID | Partner | Default Role | Default Departments |
|---|---|---|---|
| `<object-id-of-telcoM-support>` | telcoM | support | `["billing","technical"]` |
| `<object-id-of-telcoM-admin>` | telcoM | admin | *(auto-fills with all)* |

The Azure Group ID is the Object ID from Azure AD → Groups → select group
→ copy "Object ID" (GUID). **Not** the display name.

### 3. Invite the partner employee as a B2B guest

In Azure Portal → Users → "Invite external user":

- Email: the partner employee's work email (e.g. `jane@telcoM.com`)
- Group membership: assign them to **exactly one** partner group from step 1
- Send invite

Azure emails them a redemption link. They click, authenticate in their
home tenant, and are added as a guest in your tenant.

> **Strict single-partner rule.** A guest may only end up in groups that
> resolve to a single partner. If you assign them to `guichet-telcoM-admin`
> AND `guichet-otherpartner-support`, login will be rejected with error
> `guest_multi_partner_mapping` and an audit entry written. Fix by removing
> one of the group assignments in Azure.

### 4. First login

The guest navigates to `https://guichet.example.com` and clicks "Sign in
with SSO". Azure recognizes them, issues a token, and our callback:

1. Verifies the token signature + nonce.
2. Computes `isExternal = acct === 1 || !!idp` — true for a B2B guest.
3. Upserts the `users` row with `isExternal=true`.
4. Resolves Azure groups → exactly one partner → creates the membership.
5. Issues a session cookie, redirects into the tenant.

The user sees a GUEST badge next to their name in the UserMenu, in
AdminTeam if they are admin, and in QueueSidebar if they are support.

## Guest permissions matrix

| Capability | Internal staff | Guest support | Guest admin |
|---|---|---|---|
| View own partner's tickets / chat | ✅ | ✅ | ✅ |
| Handle chats (reply, close, transfer) | ✅ | ✅ | — |
| AdminView read (team, labels, webhooks, stats, archive) | ✅ | — | ✅ |
| Create/edit/delete labels | ✅ | — | ✅ |
| Update business hours | ✅ | — | ✅ |
| Update departments | ✅ | — | ❌ blocked |
| Add/invite/remove/update team members | ✅ | — | ❌ blocked |
| Create/update/delete webhooks | ✅ | — | ❌ blocked |
| Rotate webhook secret | ✅ | — | ❌ blocked |
| Test webhook delivery | ✅ | — | ❌ blocked |
| Switch tenants mid-session | ✅ (if multi-member) | — | — (guests are single-partner) |
| All `platform.*` routers | platform ops only | — | — |

"❌ blocked" means the tRPC procedure uses `destructiveAdminProcedure` and
throws FORBIDDEN with the message "This action is not available to
external guest users."

## Removing a guest's access

Two paths:

1. **Soft — remove from the partner group.** Next login (or cleanup cycle)
   removes the membership; subsequent attempts hit `no_matching_groups`.
2. **Hard — delete the B2B guest user in Azure.** Immediate effect on
   next token validation; their existing session stays valid until the
   access token expires (~15 min) because our JWTs are opaque to Azure.

If you need an immediate revoke, combine both AND use
`trpc.platform.revokeSessions` from PlatformView → Security.

## User experience notes

- Guest with one valid partner group → normal login, lands in that partner.
- Guest with zero valid groups → `sso_error=no_matching_groups`, login
  refused (existing behavior unchanged).
- Guest with two or more valid partners →
  `sso_error=guest_multi_partner_mapping`, login refused, audit entry
  written with both partnerIds and the matched group count.
- Guest trying a blocked admin mutation → friendly FORBIDDEN message;
  the button is not hidden (yet — it throws on click). This is a
  follow-up UI polish item.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Login loop with no error | Token verification failed — check `AZURE_AD_*` envs and issuer URL. | Verify `/.well-known/openid-configuration` resolves from the server. |
| `sso_error=no_matching_groups` for a guest | Azure group not mapped in Guichet, OR guest not in any mapped group. | Add group to `partner_group_mappings`, or add guest to existing group. |
| `sso_error=guest_multi_partner_mapping` | Guest is a member of groups mapped to two different partners. | Remove the guest from one of the groups in Azure AD. |
| Guest admin cannot save webhook | Expected — `destructiveAdminProcedure` blocks it. | Have an internal admin or platform operator perform the mutation. |
| GUEST badge not showing | Client has a stale `user.isExternal = undefined`. | Trigger `trpc.user.me` (or reload). Confirm `users.is_external = true` in DB. |
| Guest reports missing access after Azure group change | JWT + refresh token still cached. | Have them log out + in, or revoke their session from PlatformView. |

## Audit trail

Every guest-relevant event writes to `audit_log`:

- `sso.guest_multi_partner_rejected` — multi-partner login refused
- `sso.membership_auto_created` — guest membership provisioned
- `sso.membership_revoked` — guest lost Azure group membership
- Destructive mutations that FAIL due to the guest block are NOT audited
  by the middleware (the mutation code never runs). Add partner-side
  auditing at the mutation entry if you need that signal.

## Known limitations (follow-up work)

1. **Group overage (>200 Azure groups).** Azure truncates the `groups`
   claim and sends `_claim_names` instead. Guichet logs an error and
   the user gets no groups. Guests rarely hit this. Fix would require
   calling Microsoft Graph; not in scope.
2. **MessageBubble + ChatHeader rely on the presence store for guest
   detection.** The GUEST badge in `MessageBubble` and the amber ring
   around participant avatars in `ChatHeader` cross-reference
   `onlineSupportUsers` to learn `isExternal`. That means a guest who
   is currently offline — including historical senders in a closed
   ticket review — won't be flagged. For server-authoritative fidelity
   (badge shows regardless of live presence), denormalize
   `senderIsExternal` onto the `messages` row at insert and thread
   `isExternal` through `tickets.participants` JSON. Deferred.
3. **Destructive buttons are not visibly disabled.** A guest admin clicks,
   gets a FORBIDDEN toast. UX polish — out of scope for the initial ship.
4. **Partner-employee SSO via the partner's OWN IdP.** Not supported.
   Guests must federate through our Azure tenant. If a partner refuses
   B2B, fall back to the Option B plan (per-partner SSO).

## File map — what shipped

Server:
- `server/db/schema.ts` — `users.isExternal` column
- `server/drizzle/0005_users_is_external.sql` — migration
- `server/routes/sso.ts` — guest detection + multi-partner reject
- `server/trpc/trpc.ts` — `blockExternalUsers` middleware + `destructiveAdminProcedure`
- `server/trpc/routers/user.ts` — `me` procedure
- `server/trpc/routers/status.ts` — `getTeamStatus` enriched with `isExternal`
- `server/trpc/routers/partner/members.ts` — 4 destructive mutations guarded
- `server/trpc/routers/partner/config.ts` — `updateDepartments` guarded
- `server/trpc/routers/webhook.ts` — 5 destructive mutations guarded
- `server/services/authSession.ts` — `buildAuthResponse` returns `isExternal`
- `server/routes/auth/login.ts` — login response carries `isExternal`
- `server/__tests__/ssoGuestB2b.test.ts` — SSO-layer assertions
- `server/__tests__/destructiveAdminProcedure.test.ts` — middleware + blocklist

Client:
- `client/src/components/GuestBadge.tsx` — new component
- `client/src/components/UserMenu.tsx` — own identity badge
- `client/src/components/admin/AdminTeam.tsx` — team row badge
- `client/src/components/support/SidebarFooter.tsx` — team-panel badge
- `client/src/components/MessageBubble.tsx` — per-message sender badge (cross-refs presence store)
- `client/src/components/chat/ChatHeader.tsx` — amber ring around guest participant avatars + enriched tooltip
- `client/src/components/PartnerSwitcher.tsx` — `confirmBeforeSwitch` prop
- `client/src/components/agent/AgentNav.tsx` — switcher + confirm
- `client/src/components/support/SupportNav.tsx` — switcher + confirm
- `client/src/views/LoginView.tsx` — `guest_multi_partner_mapping` error handler
- `client/src/types/index.ts` — `isExternal?` on User + OnlineSupport
- `client/src/locales/{en,fr,nl}.ts` — 4 new keys each
- `client/src/components/__tests__/GuestBadge.test.tsx` — component test
