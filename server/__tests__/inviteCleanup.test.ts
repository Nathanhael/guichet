import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Source-level assertions for the abandoned-invite cleanup job added in
 * docs/superpowers/plans/2026-04-17-invite-orphan-cleanup.md.
 *
 * The job runs daily as part of runDailyPurge and deletes user rows that look
 * like abandoned invites: no externalId (never claimed via SSO) and
 * createdAt older than 30 days. Local auth has been removed, so there are no
 * password rows to preserve — the bootstrap operator is created with an
 * externalId by the SSO callback on first login and is therefore naturally
 * excluded by the externalId filter. Memberships are cleaned up automatically
 * by the FK ON DELETE CASCADE on memberships.userId.
 *
 * We follow the source-inspection pattern used by other non-integration tests
 * in this repo (see ssoAuditTrim / ssoGuestB2b / drizzleJournal) — runtime
 * behaviour is exercised by the existing gdpr integration tests once the
 * function is wired.
 */
describe('Abandoned-invite cleanup (GDPR daily purge)', () => {
  const gdprSource = fs.readFileSync(
    path.resolve(__dirname, '../services/gdpr.ts'), 'utf-8',
  );

  // Anchor on the `export async function` declaration so we never accidentally
  // pick up a call site inside runDailyPurge.
  const fnBody = (() => {
    const m = gdprSource.match(/export\s+async\s+function\s+purgeAbandonedInvites[\s\S]*$/);
    return m ? m[0] : '';
  })();

  describe('purgeAbandonedInvites function', () => {
    it('is exported from gdpr.ts', () => {
      expect(gdprSource).toMatch(/export\s+async\s+function\s+purgeAbandonedInvites\s*\(\s*\)\s*:\s*Promise<number>/);
    });

    it('uses a 30-day cutoff', () => {
      // 30 * 86_400_000 ms = 30 days. Plan locks this window as the final
      // backstop past the 7-day claim-by-email TTL enforced in sso.ts.
      expect(fnBody).toMatch(/30\s*\*\s*86_?400_?000/);
    });

    it('filters on externalId IS NULL AND createdAt < cutoff', () => {
      expect(fnBody).toMatch(/isNull\(users\.externalId\)/);
      expect(fnBody).toMatch(/lt\(users\.createdAt,\s*cutoff\)/);
    });

    it('caps batch size to 500 per run', () => {
      // Bound the batch so a catastrophic misconfig cannot wipe the user table
      // in one transaction. The job re-runs daily, so progress is eventual.
      expect(fnBody).toMatch(/\.limit\(500\)/);
    });

    it('deletes rows inside a transaction', () => {
      expect(fnBody).toMatch(/db\.transaction\(async\s*\(\s*tx\s*\)\s*=>/);
      expect(fnBody).toMatch(/tx\.delete\(users\)\.where\(inArray\(users\.id/);
    });

    it('writes one invite.purged_stale audit row per deleted user', () => {
      expect(fnBody).toMatch(/action:\s*['"]invite\.purged_stale['"]/);
      expect(fnBody).toMatch(/targetType:\s*['"]user['"]/);
      expect(fnBody).toMatch(/reason:\s*['"]unclaimed_30d['"]/);
    });

    it('short-circuits when there is nothing to purge', () => {
      // Early return avoids wasting a transaction on an empty batch.
      expect(fnBody).toMatch(/if\s*\(\s*stale\.length\s*===\s*0\s*\)\s*return\s+0/);
    });

    it('logs a single info line on successful purge', () => {
      expect(fnBody).toMatch(/logger\.info\(\{[^}]*count[^}]*\},\s*['"]\[gdpr\] Stale invites purged['"]/);
    });
  });

  describe('wiring into runDailyPurge', () => {
    it('purgeAbandonedInvites is called from runDailyPurge', () => {
      // The call site must live inside the main try-block so a failure is
      // caught by the purge error handler rather than crashing the daily job.
      const purgeFnMatch = gdprSource.match(/export async function runDailyPurge[\s\S]*?^}/m);
      expect(purgeFnMatch).toBeTruthy();
      expect(purgeFnMatch![0]).toMatch(/await\s+purgeAbandonedInvites\(\)/);
    });

    it('invitesPurged count is included in the audit metadata', () => {
      // So operators can verify the job is doing its work via audit_log queries.
      expect(gdprSource).toMatch(/metadata:\s*\{[^}]*invitesPurged[^}]*\}/);
    });
  });

  describe('safety invariants', () => {
    it('does NOT match rows with an externalId (claimed accounts preserved)', () => {
      // Once an invite is claimed the row has externalId set. The filter
      // guarantees we only touch unclaimed rows.
      expect(fnBody).toMatch(/isNull\(users\.externalId\)/);
    });

    it('does NOT match platform operators (bootstrap-safe)', () => {
      // The bootstrap service creates the initial platform operator with
      // externalId=null until they complete their first SSO login. Without
      // this guard, a staging/restored env where the bootstrap op has not
      // logged in for 30 days would get the operator permanently deleted
      // by the daily purge (and memberships would cascade-delete too).
      // See post-ship review 2026-04-18, finding H-1.
      expect(fnBody).toMatch(/eq\(users\.isPlatformOperator,\s*false\)/);
    });
  });

  describe('schema cascade (documented, not asserted at runtime)', () => {
    it('memberships.userId has ON DELETE CASCADE so FK cleanup is automatic', () => {
      // Schema guarantee, not gdpr.ts code — asserted here to fail loudly if
      // someone ever relaxes the cascade without updating the purge logic to
      // delete memberships explicitly first.
      const schemaSource = fs.readFileSync(
        path.resolve(__dirname, '../db/schema.ts'), 'utf-8',
      );
      const membershipsBlock = schemaSource.match(/memberships[\s\S]*?userId[\s\S]*?onDelete:\s*['"]cascade['"]/);
      expect(membershipsBlock).toBeTruthy();
    });
  });
});
