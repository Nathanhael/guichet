import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Source-level assertions for the bounded invite-claim window added in
 * docs/superpowers/plans/2026-04-17-invite-orphan-cleanup.md.
 *
 * Rationale: the pre-existing SSO callback claimed any unclaimed (no externalId)
 * user row whose email matched the Azure token — with no upper bound on row
 * age. This meant an invite created months ago could still be silently claimed
 * by someone who later controlled the matching Azure identity. The fix caps
 * that window to INVITE_TTL_DAYS and deletes the stale row on expiry rather
 * than linking.
 *
 * We match the `ssoAuditTrim.test.ts` / `ssoGuestB2b.test.ts` pattern of regex
 * assertions on the sso.ts source — no live Azure / DB stack required.
 */
describe('SSO invite claim bounded TTL window', () => {
  const ssoSource = fs.readFileSync(
    path.resolve(__dirname, '../../routes/sso.ts'), 'utf-8',
  );

  describe('TTL bound', () => {
    it('declares INVITE_TTL_DAYS constant', () => {
      expect(ssoSource).toMatch(/const\s+INVITE_TTL_DAYS\s*=\s*7\b/);
    });

    it('computes row age from user.createdAt', () => {
      expect(ssoSource).toMatch(/Date\.now\(\)\s*-\s*new Date\(user\.createdAt\)\.getTime\(\)/);
    });

    it('compares ageMs against INVITE_TTL_DAYS * ms-per-day', () => {
      expect(ssoSource).toMatch(/ageMs\s*>\s*INVITE_TTL_DAYS\s*\*\s*86_?400_?000/);
    });
  });

  describe('expired-invite path', () => {
    it('deletes the stale user row on expiry', () => {
      // Must run BEFORE redirect so the row is gone before we bounce the user
      const expiredBlock = ssoSource.match(/ageMs\s*>\s*INVITE_TTL_DAYS[\s\S]*?sso_error=invite_expired/);
      expect(expiredBlock).toBeTruthy();
      expect(expiredBlock![0]).toMatch(/db\.delete\(users\)\.where\(eq\(users\.id,\s*user\.id\)\)/);
    });

    it('writes an sso.invite_expired audit entry', () => {
      expect(ssoSource).toMatch(/action:\s*['"]sso\.invite_expired['"]/);
    });

    it('redirects with sso_error=invite_expired', () => {
      expect(ssoSource).toMatch(/sso_error=invite_expired/);
    });

    it('logs a warn line for ops visibility', () => {
      expect(ssoSource).toMatch(/logger\.warn\(\{[^}]*ageMs[^}]*\},\s*['"]\[SSO\] Invite expired/);
    });
  });

  describe('valid-window path', () => {
    it('still links externalId + name when within TTL', () => {
      expect(ssoSource).toMatch(
        /db\.update\(users\)\.set\(\{[^}]*externalId:\s*oid[^}]*\}\)\.where\(eq\(users\.id,\s*user\.id\)\)/s,
      );
    });

    it('writes an sso.invite_claimed audit entry', () => {
      expect(ssoSource).toMatch(/action:\s*['"]sso\.invite_claimed['"]/);
    });

    it('ages metadata includes ageMs for forensic review', () => {
      const claimedBlock = ssoSource.match(
        /action:\s*['"]sso\.invite_claimed['"][\s\S]*?metadata:\s*\{[^}]*\}/,
      );
      expect(claimedBlock).toBeTruthy();
      expect(claimedBlock![0]).toMatch(/ageMs/);
    });
  });

  describe('ordering invariants', () => {
    it('TTL check happens before the link update', () => {
      // The TTL gate must run BEFORE we stamp externalId onto the row,
      // otherwise a stale invite row would be silently claimed rather than
      // deleted.
      const ttlIdx = ssoSource.search(/INVITE_TTL_DAYS/);
      const linkUpdateIdx = ssoSource.search(/db\.update\(users\)\.set\(\{[^}]*externalId:\s*oid/s);
      expect(ttlIdx).toBeGreaterThan(-1);
      expect(linkUpdateIdx).toBeGreaterThan(ttlIdx);
    });
  });
});
