# M2 — Stranded Invite Orphans + Claim-by-Email Window

**Date**: 2026-04-17
**Branch**: `fix/invite-orphan-cleanup`
**Finding**: Review M2 — `inviteExternalUser` creates DB row with no password/externalId, SSO callback claims it by email-match. Orphan rows persist forever; claim window is unbounded.
**Status**: Proposed

---

## What's actually wrong

Two sites create user rows with no password and no externalId:

| Where | Who calls it |
|---|---|
| [partner/members.ts:188](../../../server/trpc/routers/partner/members.ts) `inviteExternalUser` | Partner admin invites a B2B guest |
| [platform/users.ts:156](../../../server/trpc/routers/platform/users.ts) `inviteUser` | Platform operator invites anyone (inc. platform ops) |

Both produce a row that the SSO callback will later claim via **email match** ([sso.ts:254-275](../../../server/routes/sso.ts)):

```ts
// 1. lookup by externalId → miss
// 2. lookup by email → hit an unclaimed invite
// 3. if user.password null → link externalId, log info
```

### Risks

1. **Orphan rows forever**: Admin typos an email, target never comes. Row sits indefinitely. No TTL, no alert, no cleanup.
2. **Unbounded claim-by-email window**: Row created 2 years ago still claimable today by anyone who controls an Azure identity with that email. An ex-employee whose corporate email got re-issued at their old company could log into Guichet as someone who never existed there.
3. **No audit trail on the claim**: `sso.ts:275` emits a `logger.info` line. No `audit_log` entry. Forensics after-the-fact is log-scraping only.

### Not actually wrong

- "No password/externalId" itself is correct for a B2B SSO flow — admin creates the row, user arrives via Azure B2B later. Not a bug, just the invite pattern.
- Email-match linking of unclaimed rows is the intended design. Can't remove it without breaking the invite flow.
- `destructiveAdminProcedure` already blocks external admins from creating invites, so only internal admins can seed orphan rows. Closes one attack surface.

---

## Scope

**Minimal defensible fix. No new column, no new table.** `users.createdAt` already marks the invite moment — "unclaimed invite" is fully characterised by `externalId IS NULL AND password IS NULL`.

### Changes

#### 1. SSO callback: bounded claim window + audit trail

[server/routes/sso.ts:272-276](../../../server/routes/sso.ts) — when linking an email-matched unclaimed row, check age:

```ts
// Safe to link: account has no password (SSO-only or uninitialised invite)
const INVITE_TTL_DAYS = 7;
const ageMs = Date.now() - new Date(user.createdAt).getTime();
if (ageMs > INVITE_TTL_DAYS * 86_400_000) {
  logger.warn({ userId: user.id, oid, email, ageMs },
    '[SSO] Invite expired — rejecting claim and deleting stale row');
  await db.insert(auditLog).values({
    action: 'sso.invite_expired',
    targetType: 'user', targetId: user.id,
    metadata: { email, oid, ageMs },
  });
  await db.delete(users).where(eq(users.id, user.id));
  return res.redirect(`${clientOrigin}/login?sso_error=invite_expired`);
}
await db.update(users).set({ externalId: oid, name, isExternal }).where(eq(users.id, user.id));
await db.insert(auditLog).values({
  action: 'sso.invite_claimed',
  actorId: user.id,
  targetType: 'user', targetId: user.id,
  metadata: { email, oid, ageMs },
});
logger.info({ userId: user.id, oid, isExternal, ageMs }, '[SSO] Linked existing user to Azure OID');
```

Two new audit actions: `sso.invite_claimed` (success path) and `sso.invite_expired` (rejection path).

#### 2. Scheduled cleanup: purge abandoned invites

Add to `server/services/gdpr.ts` (or new `inviteCleanup.ts` if gdpr.ts is too dense). Daily job, batched, idempotent:

```ts
export async function purgeAbandonedInvites(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const stale = await db.select({ id: users.id, email: users.email })
    .from(users)
    .where(and(
      isNull(users.externalId),
      isNull(users.password),
      lt(users.createdAt, cutoff),
    ))
    .limit(500);
  if (stale.length === 0) return 0;

  await db.transaction(async (tx) => {
    await tx.delete(users).where(inArray(users.id, stale.map(s => s.id)));
    await tx.insert(auditLog).values(stale.map(s => ({
      action: 'invite.purged_stale',
      targetType: 'user', targetId: s.id,
      metadata: { email: s.email, reason: 'unclaimed_30d' },
    })));
  });
  logger.info({ count: stale.length }, '[gdpr] Stale invites purged');
  return stale.length;
}
```

Memberships FK is `onDelete: cascade` — purging the user cleans up its orphan memberships automatically.

**Schedule**: piggyback on the existing daily GDPR purge in [server/app.ts:423+](../../../server/app.ts).

**Edge case — platform operator bootstrap**: [bootstrap.ts:77](../../../server/services/bootstrap.ts) creates the initial platform operator with `password` set from env, so they survive the criterion. Platform operators invited via `platform/users.ts:156` without password get swept up. That's arguably correct — if a platform operator hasn't logged in 30 days after invite, someone else should re-invite.

#### 3. Tests

| File | Cases |
|---|---|
| `server/__tests__/routes/ssoInviteClaim.test.ts` (new) | Valid window links + audits; expired window rejects + deletes + audits |
| `server/__tests__/inviteCleanup.test.ts` (new) | Purges 31-day-old unclaimed row; preserves user with externalId; preserves user with password; preserves 29-day-old row; cascades membership deletion; audit rows written |

Pattern: real DB via existing test infra (not mocked — matches isolation.test.ts, archiveBatch.test.ts style).

---

## Out of scope

- Sending an actual invite email — current flow is "admin tells user out-of-band, user logs in via SSO." Adding email is a feature, not a bug fix. If we want that, separate plan.
- UI for admins to see pending/expired invites — useful but not required to close M2.
- Shortening the 30-day cleanup window — 30 days matches GDPR retention elsewhere. Tunable later.
- Extending bounded-window logic to `addMemberByEmail` — that path requires a pre-existing user, so there's no unclaimed row to claim.

---

## Risk assessment

| Risk | Mitigation |
|---|---|
| Legitimate user tries to log in day 8 of 7-day window | Get `sso_error=invite_expired` → admin re-invites. Friction, not data loss. 7 days is a defensible default; make it configurable later if ops requests. |
| Cleanup job deletes a valid pending invite | Criterion is `externalId IS NULL AND password IS NULL AND createdAt < 30d`. 30 days is well past the 7-day SSO link window, so anything surviving cleanup is definitionally abandoned. |
| Cascade deletes blow away audit trail | `audit_log` FK to user is `onDelete: set null` (checked — line 4 of grep output above). Audit rows survive the user deletion. |
| Migrations needed | None. Uses existing `createdAt` column. |

---

## Verification checklist

- [ ] `server/__tests__/routes/ssoInviteClaim.test.ts` passes (new)
- [ ] `server/__tests__/inviteCleanup.test.ts` passes (new)
- [ ] Full suite: no regressions, expected test count +≥6
- [ ] `tsc --noEmit` clean
- [ ] Manual: create invite → wait 8 days (or set system clock) → attempt SSO → rejected with `invite_expired`, row deleted, audit entry present
- [ ] Manual: create invite → SSO within 7 days → linked, `sso.invite_claimed` audit entry present

---

## Rollback

Revert the sso.ts edit and remove the cleanup call from app.ts. No schema change to revert. No data migration.
