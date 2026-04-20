import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Source-level assertions for destructiveAdminProcedure + blocklist applied in
 * docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md (Task 3).
 *
 * Follows the same pragmatic pattern as `ssoAuditTrim.test.ts` — regex on the
 * router sources rather than exercising tRPC at runtime. Runtime behavior is
 * covered by the Playwright E2E spec `partner-guest-b2b.spec.ts`.
 */
describe('destructiveAdminProcedure guards', () => {
  const trpcSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/trpc.ts'), 'utf-8',
  );
  const webhookSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/webhook.ts'), 'utf-8',
  );
  const membersSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/partner/members.ts'), 'utf-8',
  );
  const configSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/partner/config.ts'), 'utf-8',
  );

  describe('middleware definition', () => {
    it('exports blockExternalUsers middleware', () => {
      expect(trpcSource).toMatch(/export const blockExternalUsers\s*=\s*t\.middleware/);
    });

    it('exports destructiveAdminProcedure derived from adminProcedure', () => {
      expect(trpcSource).toMatch(
        /export const destructiveAdminProcedure\s*=\s*adminProcedure\.use\(blockExternalUsers\)/,
      );
    });

    it('blockExternalUsers fetches users.isExternal from DB', () => {
      // JWT does not carry the flag — the middleware must DB-lookup per call.
      expect(trpcSource).toMatch(
        /blockExternalUsers[\s\S]*?db[\s\S]*?\.select\(\s*\{\s*isExternal:\s*users\.isExternal/,
      );
    });

    it('blockExternalUsers short-circuits for platform operators (no DB hit)', () => {
      expect(trpcSource).toMatch(
        /blockExternalUsers[\s\S]*?isPlatformAdmin\(ctx\.user\.isPlatformOperator\)[\s\S]*?return next\(\)/,
      );
    });

    it('blockExternalUsers throws FORBIDDEN when isExternal is true', () => {
      expect(trpcSource).toMatch(
        /blockExternalUsers[\s\S]*?row\[0\]\?\.isExternal[\s\S]*?code:\s*['"]FORBIDDEN['"]/,
      );
    });
  });

  describe('webhook router blocklist', () => {
    it('defines a guest-blocked variant of gatedPartnerAdmin', () => {
      expect(webhookSource).toMatch(
        /const\s+gatedPartnerAdminNoGuests\s*=\s*gatedPartnerAdmin\.use\(blockExternalUsers\)/,
      );
    });

    it.each([
      ['create'],
      ['update'],
      ['regenerateSecret'],
      ['delete'],
      ['test'],
    ])('webhook.%s uses gatedPartnerAdminNoGuests', (op) => {
      const re = new RegExp(`\\b${op}:\\s*gatedPartnerAdminNoGuests\\b`);
      expect(webhookSource).toMatch(re);
    });

    it('list and logs remain on the plain gatedPartnerAdmin (reads stay open)', () => {
      expect(webhookSource).toMatch(/\blist:\s*gatedPartnerAdmin\.query/);
      expect(webhookSource).toMatch(/\blogs:\s*gatedPartnerAdmin\b/);
    });
  });

  describe('partner.members router blocklist', () => {
    it.each([
      ['inviteExternalUser'],
      ['updateMember'],
      ['removeMember'],
    ])('members.%s uses destructiveAdminProcedure', (op) => {
      const re = new RegExp(`\\b${op}:\\s*destructiveAdminProcedure\\b`);
      expect(membersSource).toMatch(re);
    });

    it('listMembers remains on adminProcedure (read stays open)', () => {
      expect(membersSource).toMatch(/\blistMembers:\s*adminProcedure\b/);
    });

    it('imports destructiveAdminProcedure from trpc.js', () => {
      expect(membersSource).toMatch(/import\s*\{[^}]*destructiveAdminProcedure[^}]*\}\s*from\s*['"]\.\.\/\.\.\/trpc\.js['"]/);
    });
  });

  describe('partner.config router blocklist', () => {
    it('updateDepartments uses destructiveAdminProcedure', () => {
      expect(configSource).toMatch(/\bupdateDepartments:\s*destructiveAdminProcedure\b/);
    });

    it('updateBusinessHours remains on adminProcedure (low-risk tenant op)', () => {
      expect(configSource).toMatch(/\bupdateBusinessHours:\s*adminProcedure\b/);
    });

    it('getManifest remains on adminProcedure (read)', () => {
      expect(configSource).toMatch(/\bgetManifest:\s*adminProcedure\.query\b/);
    });
  });
});
