# SSO Setup Runbook

End-to-end setup for Azure Entra ID SSO on Guichet — both the **one-time deploy
wiring** and the **per-partner onboarding** repeated for every business unit.

Architecture context: Guichet runs as a **single-tenant SSO app** (one app
registration in our Entra tenant) with **multiple partners as business units**
and **B2B guests** for partner employees. See `docs/TENANT_IDENTITY_SPEC.md` for
guest-vs-internal semantics.

---

## 1. One-time per deploy

### 1.1 App registration

Portal: portal.azure.com → Microsoft Entra ID → App registrations → **New registration**.

| Field | Value |
|---|---|
| Name | `Guichet — <env>` (e.g. `Guichet — Production`) |
| Supported account types | **Single tenant** |
| Redirect URI | Web → `https://<your-host>/api/v1/auth/sso/azure/callback` (use `http://localhost:3001/...` in dev) |

After creation:

1. **Overview** → copy **Application (client) ID** and **Directory (tenant) ID**.
2. **Certificates & secrets** → **New client secret** → copy the **Value**
   (only shown once). Set a calendar reminder to rotate before the expiry.
3. **API permissions** → **Add** → Microsoft Graph → Delegated:
   `User.Read`, `email`, `openid`, `profile` → **Grant admin consent**.
4. **Token configuration** → **Add groups claim** → choose **Security groups**,
   format **Group ID**. (Required for the partner-mapping flow in §2.)
5. **Manifest** → confirm `groupMembershipClaims: "SecurityGroup"` and
   `optionalClaims.idToken` includes `{ "name": "groups" }`.

### 1.2 Disable Entra Security Defaults (or configure CA)

New tenants ship with security defaults that force every user through MFA
enrollment on first sign-in. For a dev tenant or any deployment that handles
its own MFA upstream, disable them:

Portal → Microsoft Entra ID → **Properties** → **Manage security defaults** →
toggle **Disabled** → pick a reason → Save.

For prod, prefer Conditional Access policies over leaving security defaults on
— the wizard interrupts every B2B guest's first login.

### 1.3 Environment variables

Set in `.env` (or your secrets manager):

```
AZURE_AD_TENANT_ID=<directory-id>
AZURE_AD_CLIENT_ID=<application-id>
AZURE_AD_CLIENT_SECRET=<secret-value>
AZURE_AD_REDIRECT_URI=https://<your-host>/api/v1/auth/sso/azure/callback
INTERNAL_EMAIL_DOMAINS=<your-internal-domain>,<other-internal-domain>
```

`INTERNAL_EMAIL_DOMAINS` controls the `users.isExternal` flag at SSO callback —
emails matching these domains are treated as internal staff and skip the
`destructive_admin` capability gate. Customer/partner employee emails should
**not** be in this list (they get the GUEST badge + the gate).

Production hardening (`config.ts` enforces FATAL exits when `NODE_ENV=production`):

| Var | Required |
|---|---|
| `COOKIE_SECURE` | `true` (HTTPS only) |
| `FRONTEND_URL` | Your prod URL — must not contain `localhost` |
| `CORS_ORIGIN` | Your prod URL — must not contain `localhost` |

### 1.4 Docker IPv6 quirk

`login.microsoftonline.com` only returns AAAA (IPv6) records by default. The
default Docker bridge has no IPv6 route, so the server's outbound JWKS /
token-exchange fetches fail with `ENETUNREACH`. The `docker-compose.yml`
server service includes:

```yaml
sysctls:
  - net.ipv6.conf.all.disable_ipv6=1
  - net.ipv6.conf.default.disable_ipv6=1
```

This forces the resolver to return only A records inside the container.
Alternatives: enable IPv6 in the Docker daemon, or ensure outbound IPv6 routing
on the host. Don't silently drop the sysctls without confirming an alternative
works.

### 1.5 Verify the wiring

Inside the running server container:

```bash
docker compose exec -T server node -e \
  "fetch('https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}/discovery/v2.0/keys')
   .then(r => console.log('jwks=' + r.status))
   .catch(e => console.log('ERR=' + e.message + ' ' + (e.cause && e.cause.code)))"
```

Expected: `jwks=200`. Anything else means the IPv6 / DNS / outbound-egress
setup needs more work before SSO will work.

---

## 2. Per-partner onboarding

For each new business unit (Acme, PXS, Multipool, ...).

### 2.1 Create the partner row

Log in as platform operator → **PlatformView** → Partners → **New** → fill in
name, industry, departments, etc. The partner ID (slug) is what you reference
in step 2.3.

### 2.2 Create security groups in Entra

One group per role tier the partner needs. Convention: prefix with `Partner-`
so the SSO panel listing stays scannable.

CLI (replace `<name>` with the partner slug, e.g. `acme`):

```powershell
$slug = "acme"
foreach ($role in @("Admins","Support","Agents")) {
  $id = az ad group create `
    --display-name "Partner-$slug-$role" `
    --mail-nickname "partner-$($slug.ToLower())-$($role.ToLower())" `
    --query id -o tsv
  Write-Host "Partner-$slug-$role  $id"
}
```

Note the group Object IDs — they're what you paste into the mapping panel.

### 2.3 Map groups to partner + role in Guichet

PlatformView → **SSO** tab → GroupMappingsPanel → add one row per group:

| Field | Value |
|---|---|
| Azure group ID | The Object ID from §2.2 |
| Partner | The partner you created in §2.1 |
| Default role | `admin` / `support` / `agent` (match the group's tier) |
| Default departments | Optional. Leave empty for `admin` and `support` (they auto-default to all partner departments). Specify for narrowly-scoped agents. |

The role priority logic in `routes/sso.ts:420` resolves to the **highest role
across all matched groups** per partner (admin > support > agent), so a user in
both `Partner-Acme-Support` and `Partner-Acme-Agents` lands as support.

### 2.4 Onboard partner employees as B2B guests

For each partner employee:

1. **Invite as B2B guest**: Entra → Users → **New user** → **Invite external
   user** → enter their email (any IdP — Microsoft, Google, their own Entra,
   etc.). Microsoft sends them an invitation email.
2. **Add to group(s)**: open the appropriate `Partner-<slug>-<Role>` group →
   Members → **Add** → pick the guest.
3. Tell the user to accept the invitation email (they consent once to share
   profile info), then log in to Guichet via the **Sign in with Microsoft**
   button.

CLI (single-shot guest invite — also creates the redirect URL Microsoft will
include in the email):

```powershell
$body = @'
{
  "invitedUserEmailAddress": "person@theircompany.com",
  "invitedUserDisplayName": "Person Name",
  "inviteRedirectUrl": "https://<your-host>/",
  "sendInvitationMessage": true
}
'@
$body | Out-File -Encoding ascii -NoNewline -FilePath "$env:TEMP\invite.json"
$invite = az rest --method post `
  --url "https://graph.microsoft.com/v1.0/invitations" `
  --headers "Content-Type=application/json" `
  --body "@$env:TEMP\invite.json" -o json | ConvertFrom-Json
$invite.invitedUser.id  # add this object ID to the group below
az ad group member add --group "<group-id>" --member-id $invite.invitedUser.id
```

### 2.5 Single-partner enforcement for guests

A B2B guest whose Azure groups resolve to **more than one partner** is
**rejected at login** with `sso_error=guest_multi_partner_mapping` and an
audit row (`sso.guest_multi_partner_rejected`). This is intentional — strict
tenant isolation. If the same person needs access to two partners, use two
separate guest invitations under different email aliases, or convert them to
internal staff.

### 2.6 Customer admin self-service

B2B guests are blocked from `destructive_admin` mutations
(`partner.members.add/update/remove/invite`, webhook CRUD/secret rotation,
partner department + SLA edits). Two options if a partner wants to manage
their own people without going through the platform op:

1. **Group owner pattern (recommended)** — make the customer's designated admin
   the **owner** of their `Partner-<slug>-*` security groups (Entra → Groups →
   the group → Owners → Add). They can add/remove members in their own groups
   without tenant-admin access. SSO callback picks up the change on the
   member's next login.
2. **Internal-staff promotion** — invite them as a regular tenant member
   instead of a guest, add their domain to `INTERNAL_EMAIL_DOMAINS`. They lose
   the GUEST badge and the gate. Heavyweight; defeats the B2B model. Only
   appropriate for embedded contractors.

---

## 3. Provisioning behavior on every SSO login

What the callback at `routes/sso.ts:419-554` does on each successful login:

| Step | Action |
|---|---|
| 1 | Read `claims.groups` from the verified ID token |
| 2 | Look up `partner_group_mappings` for each group ID against active partners |
| 3 | Per partner, pick the highest-priority role across matching groups (admin > support > agent) |
| 4 | If no membership exists for that partner → create one with `source='sso'` |
| 5 | If an SSO-source membership exists with a different role → update role + audit `sso.role_synced` |
| 6 | If an SSO-source membership exists for a partner the user no longer maps to → delete + audit `sso.membership_revoked` |
| 7 | Manually-created memberships (`source != 'sso'`) are never modified or deleted |

Implications:

- **Demoting a user**: remove them from the higher-tier group. They'll be
  re-provisioned to the lower tier on next login.
- **Removing access entirely**: remove from all the partner's groups. Next
  login revokes the SSO-source membership.
- **Manual overrides win**: a hand-edited membership (or one created via the
  Members panel before SSO existed) won't be touched by the sync.

---

## 4. Common errors & fixes

| `sso_error=` query param | Cause | Fix |
|---|---|---|
| `no_matching_groups` | Token had `groupCount: 0` for a user with no internal-staff fallback | Stale Microsoft session — sign out fully (incognito works) and retry. If groups claim genuinely missing, re-check §1.1 step 4 (Token configuration) |
| `guest_multi_partner_mapping` | Guest's groups resolve to 2+ partners | Reduce their group memberships, or convert to internal staff |
| `invite_expired` | Pre-invited user didn't claim within the 30-day window | Issue a new invite |
| `token_exchange_failed` / `token_verification_failed` | App reg secret rotated, expired, or wrong | Issue a new client secret in Entra and update `AZURE_AD_CLIENT_SECRET` |
| `nonce_mismatch` | Possible token replay; usually benign (browser back-button on the callback URL) | Retry the login |
| `internal_error` (with server log `fetch failed cause=ENETUNREACH`) | Docker IPv6 / Microsoft AAAA-only DNS | See §1.4 |

To inspect what claims Microsoft actually sent, temporarily add to
`server/routes/sso.ts` after the JWT verification block:

```ts
logger.info({
  claimKeys: Object.keys(claims),
  groups: claims.groups,
  _claim_names: claims._claim_names,
}, '[SSO DEBUG] Token claims dump');
```

Restart the server, retry the login, read `docker logs guichet-server-1`,
**then remove the debug log**. Don't ship it.

---

## 5. Verification queries

After a user signs in via SSO, confirm provisioning landed:

```bash
docker compose exec -T db psql -U user -d guichet -c \
  "SELECT u.id, u.email, u.is_external, u.external_id IS NOT NULL AS has_oid,
          m.role, m.source, m.departments, m.partner_id
   FROM users u
   LEFT JOIN memberships m ON m.user_id = u.id
   WHERE u.email = '<the-user-email>';"
```

Expected for a normal SSO login:

- `has_oid = t` (Azure OID stamped)
- `is_external = t` for B2B guests, `f` for `INTERNAL_EMAIL_DOMAINS` matches
- `m.source = 'sso'` for group-provisioned memberships
- `m.role` matches the highest-priority group they're in
