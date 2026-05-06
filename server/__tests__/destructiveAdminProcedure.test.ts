import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Source-level assertions that pin the post-#71 shape of the B2B-guest gate.
 *
 * Bundle A slice 6 (issue #71) deleted the `blockExternalUsers` middleware and
 * its three procedure-factory wrappers (`destructiveAdminProcedure`,
 * `internalAdminReadProcedure`, `partnerInternalAdminReadProcedure`). Every
 * previously-gated handler now resolves the gate inline via
 * `trpcActor(ctx, { capability: 'destructive_admin' })`. These regex checks
 * keep that contract from regressing under future edits.
 *
 * Runtime FORBIDDEN behavior for the migrated handlers is covered by:
 *   - server/trpc/routers/partner.audit.guestGating.test.ts
 *   - server/trpc/routers/partner.listAdmins.test.ts
 *   - server/trpc/routers/webhook.guestGating.test.ts
 *   - testing/e2e/partner-guest-b2b.spec.ts
 */
describe('post-#71 capability-gate enforcement (source-level)', () => {
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
  const auditSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/partner/audit.ts'), 'utf-8',
  );

  describe('middleware + wrappers are gone from trpc.ts', () => {
    it('blockExternalUsers middleware is not exported', () => {
      expect(trpcSource).not.toMatch(/export const blockExternalUsers\b/);
    });

    it('destructiveAdminProcedure wrapper is not exported', () => {
      expect(trpcSource).not.toMatch(/export const destructiveAdminProcedure\b/);
    });

    it('internalAdminReadProcedure wrapper is not exported', () => {
      expect(trpcSource).not.toMatch(/export const internalAdminReadProcedure\b/);
    });

    it('partnerInternalAdminReadProcedure wrapper is not exported', () => {
      expect(trpcSource).not.toMatch(/export const partnerInternalAdminReadProcedure\b/);
    });

    it('points readers at services/auth/capabilities.ts for the new rule', () => {
      expect(trpcSource).toMatch(/services\/auth\/capabilities\.ts/);
      expect(trpcSource).toMatch(/destructive_admin/);
    });
  });

  describe('webhook router uses inline capability gate', () => {
    it('does not declare gatedPartnerAdminNoGuests anymore', () => {
      expect(webhookSource).not.toMatch(/gatedPartnerAdminNoGuests\b/);
    });

    it('does not import blockExternalUsers from trpc.ts', () => {
      expect(webhookSource).not.toMatch(/blockExternalUsers/);
    });

    it('imports trpcActor from services/auth', () => {
      expect(webhookSource).toMatch(
        /import\s*\{[^}]*trpcActor[^}]*\}\s*from\s*['"]\.\.\/\.\.\/services\/auth\/index\.js['"]/,
      );
    });

    it.each([
      ['create'],
      ['update'],
      ['regenerateSecret'],
      ['delete'],
      ['test'],
    ])('webhook.%s uses plain gatedPartnerAdmin (no NoGuests)', (op) => {
      const re = new RegExp(`\\b${op}:\\s*gatedPartnerAdmin\\b`);
      expect(webhookSource).toMatch(re);
    });

    it.each([
      ['create'],
      ['update'],
      ['regenerateSecret'],
      ['delete'],
      ['test'],
    ])('webhook.%s body asserts destructive_admin capability inline', (op) => {
      // Pin: the capability arg must appear in the same handler body as the
      // op key. Using a capped greedy match between the op definition and the
      // next op or end-of-router avoids cross-contamination.
      const re = new RegExp(
        `\\b${op}:\\s*gatedPartnerAdmin[\\s\\S]{0,3000}?trpcActor\\(\\s*ctx\\s*,\\s*\\{\\s*capability:\\s*['"]destructive_admin['"]`,
      );
      expect(webhookSource).toMatch(re);
    });

    it('list and logs remain on plain gatedPartnerAdmin (reads stay open to guests)', () => {
      expect(webhookSource).toMatch(/\blist:\s*gatedPartnerAdmin\.query/);
      expect(webhookSource).toMatch(/\blogs:\s*gatedPartnerAdmin\b/);
    });
  });

  describe('partner.members router uses inline capability gate', () => {
    it('does not import the deleted wrappers', () => {
      expect(membersSource).not.toMatch(/destructiveAdminProcedure/);
      expect(membersSource).not.toMatch(/internalAdminReadProcedure/);
    });

    it.each([
      ['listAdmins'],
      ['updateMemberDepartments'],
    ])('members.%s uses partnerAdminProcedure', (op) => {
      const re = new RegExp(`\\b${op}:\\s*partnerAdminProcedure\\b`);
      expect(membersSource).toMatch(re);
    });

    it.each([
      ['listAdmins'],
      ['updateMemberDepartments'],
    ])('members.%s body asserts destructive_admin capability inline', (op) => {
      const re = new RegExp(
        `\\b${op}:\\s*partnerAdminProcedure[\\s\\S]{0,4000}?trpcActor\\(\\s*ctx\\s*,\\s*\\{\\s*capability:\\s*['"]destructive_admin['"]`,
      );
      expect(membersSource).toMatch(re);
    });

    it('listMembers + memberStats remain on adminProcedure (reads stay open)', () => {
      expect(membersSource).toMatch(/\blistMembers:\s*adminProcedure\b/);
      expect(membersSource).toMatch(/\bmemberStats:\s*adminProcedure\b/);
    });
  });

  describe('partner.config router uses inline capability gate', () => {
    it('does not import destructiveAdminProcedure', () => {
      expect(configSource).not.toMatch(/destructiveAdminProcedure/);
    });

    it.each([
      ['updateDepartments'],
      ['updateDepartmentSla'],
    ])('config.%s uses partnerAdminProcedure', (op) => {
      const re = new RegExp(`\\b${op}:\\s*partnerAdminProcedure\\b`);
      expect(configSource).toMatch(re);
    });

    it.each([
      ['updateDepartments'],
      ['updateDepartmentSla'],
    ])('config.%s body asserts destructive_admin capability inline', (op) => {
      const re = new RegExp(
        `\\b${op}:\\s*partnerAdminProcedure[\\s\\S]{0,3000}?trpcActor\\(\\s*ctx\\s*,\\s*\\{\\s*capability:\\s*['"]destructive_admin['"]`,
      );
      expect(configSource).toMatch(re);
    });

    it('updateBusinessHours + getManifest remain on adminProcedure (low-risk reads/writes)', () => {
      expect(configSource).toMatch(/\bupdateBusinessHours:\s*adminProcedure\b/);
      expect(configSource).toMatch(/\bgetManifest:\s*adminProcedure\.query\b/);
    });
  });

  describe('partner.audit router uses inline capability gate', () => {
    it('does not import partnerInternalAdminReadProcedure', () => {
      expect(auditSource).not.toMatch(/partnerInternalAdminReadProcedure/);
    });

    it.each([
      ['getAuditLog'],
      ['getForTicket'],
    ])('audit.%s uses partnerAdminProcedure', (op) => {
      const re = new RegExp(`\\b${op}:\\s*partnerAdminProcedure\\b`);
      expect(auditSource).toMatch(re);
    });

    it.each([
      ['getAuditLog'],
      ['getForTicket'],
      ['exportAuditLog'],
    ])('audit.%s body asserts audit_read capability inline', (op) => {
      const re = new RegExp(
        `\\b${op}:\\s*partnerAdminProcedure[\\s\\S]{0,4000}?trpcActor\\(\\s*ctx\\s*,\\s*\\{\\s*capability:\\s*['"]audit_read['"]`,
      );
      expect(auditSource).toMatch(re);
    });
  });

  describe('partner.config AI customization routes are guest-gated', () => {
    it('getAiCustomization body asserts ai_config_read capability inline', () => {
      const re = /\bgetAiCustomization:\s*adminProcedure[\s\S]{0,2000}?trpcActor\(\s*ctx\s*,\s*\{\s*capability:\s*['"]ai_config_read['"]/;
      expect(configSource).toMatch(re);
    });

    it('updateAiCustomization body asserts destructive_admin capability inline', () => {
      const re = /\bupdateAiCustomization:\s*adminProcedure[\s\S]{0,3000}?trpcActor\(\s*ctx\s*,\s*\{\s*capability:\s*['"]destructive_admin['"]/;
      expect(configSource).toMatch(re);
    });
  });
});
