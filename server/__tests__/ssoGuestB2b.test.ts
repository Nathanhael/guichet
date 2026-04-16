import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Source-level assertions for the Azure B2B guest flow added in
 * docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md.
 *
 * We follow the same pattern as `ssoAuditTrim.test.ts` (regex on the sso.ts
 * source) rather than spinning up a real Azure + DB stack. Runtime behavior
 * is covered by the Playwright E2E spec `partner-guest-b2b.spec.ts`.
 */
describe('SSO Azure B2B guest detection and rejection', () => {
  const ssoSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/sso.ts'), 'utf-8',
  );
  // NB: client-side assertions (LoginView handler, locale keys) live in a
  // client-side Vitest test (`client/src/__tests__/ssoGuestI18n.test.ts`).
  // The server container does not have the client tree mounted (`/app` ==
  // server dir only), so reading client files from here ENOENTs inside CI.

  describe('isExternal detection', () => {
    it('detects B2B guest via acct === 1 OR idp claim', () => {
      // Detector is an OR because legacy Azure token configs may omit `acct`.
      // Either signal alone is sufficient; both absent = internal member.
      expect(ssoSource).toMatch(/isExternal[^=]*=\s*claims\.acct\s*===\s*1\s*\|\|\s*!!claims\.idp/);
    });

    it('declares acct and idp as optional claim fields', () => {
      expect(ssoSource).toMatch(/acct\?:\s*number/);
      expect(ssoSource).toMatch(/idp\?:\s*string/);
    });
  });

  describe('isExternal persistence', () => {
    it('writes isExternal on new-user insert', () => {
      // Brand-new SSO user branch includes the flag
      expect(ssoSource).toMatch(/db\.insert\(users\)\.values\(\{[^}]*isExternal[^}]*\}\)/s);
    });

    it('writes isExternal when linking existing user to Azure OID', () => {
      expect(ssoSource).toMatch(/db\.update\(users\)\.set\(\{[^}]*externalId:\s*oid[^}]*isExternal[^}]*\}\)/s);
    });

    it('writes isExternal on returning-user sync', () => {
      // Third write site — update in the "user exists" branch
      const syncUpdates = ssoSource.match(/db\s*\.update\(users\)\s*\.set\(\{[^}]*\}\)/gs) || [];
      const hasSyncWithIsExternal = syncUpdates.some(
        (block) => block.includes('isExternal') && block.includes('email'),
      );
      expect(hasSyncWithIsExternal).toBe(true);
    });
  });

  describe('guest single-partner enforcement', () => {
    it('rejects guest when resolved to more than one partner', () => {
      expect(ssoSource).toMatch(/isExternal\s*&&\s*targetMemberships\.size\s*>\s*1/);
    });

    it('redirects to sso_error=guest_multi_partner_mapping on rejection', () => {
      expect(ssoSource).toMatch(/sso_error=guest_multi_partner_mapping/);
    });

    it('writes an audit entry with action sso.guest_multi_partner_rejected', () => {
      expect(ssoSource).toMatch(/action:\s*['"]sso\.guest_multi_partner_rejected['"]/);
    });

    it('audit metadata keeps group data minimal (groupCount, not full array)', () => {
      // Security hygiene (#45): full azureGroups array must not be stored in
      // audit_log.metadata JSONB — use groupCount instead. The full array is
      // available in the structured log line for ops diagnosis.
      const rejectBlock = ssoSource.match(
        /action:\s*['"]sso\.guest_multi_partner_rejected['"][\s\S]*?metadata:\s*\{[^}]*\}/,
      );
      expect(rejectBlock).toBeTruthy();
      expect(rejectBlock![0]).toMatch(/groupCount/);
      // azureGroups must NOT be inlined as a metadata key in this block
      expect(rejectBlock![0]).not.toMatch(/metadata:\s*\{[^}]*azureGroups[^:]*\}/);
    });

    it('rejection happens BEFORE the membership upsert loop', () => {
      // The guard must short-circuit before we write any memberships —
      // otherwise a guest might leak a partial membership row before rejection.
      const guardIdx = ssoSource.search(/isExternal\s*&&\s*targetMemberships\.size\s*>\s*1/);
      const upsertIdx = ssoSource.search(/Upsert current memberships/);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(upsertIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(upsertIdx);
    });
  });

  describe('internal staff unaffected', () => {
    it('multi-partner auto-migrate logic remains (line ~411 in original)', () => {
      // The cleanup block that revokes memberships for SSO-mapped partners
      // when the user loses group membership must still be present — this is
      // correct behavior for internal staff and we explicitly left it alone.
      expect(ssoSource).toMatch(/Remove memberships for partners that HAVE SSO mappings/);
    });
  });

  // Client i18n coverage moved to client/src/__tests__/ssoGuestI18n.test.ts.
});
