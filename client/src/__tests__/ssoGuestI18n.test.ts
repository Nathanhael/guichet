import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Client-side half of the Azure B2B guest SSO test coverage. The server-side
 * half lives in `server/__tests__/ssoGuestB2b.test.ts`; these two files
 * cannot share a process because CI runs server tests and client tests in
 * separate Docker containers that only mount their own tree.
 *
 * Kept as source-string assertions (same pattern as the server side) because
 * the alternative — wiring a full i18n runtime — is overkill for presence
 * checks.
 *
 * See docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md.
 */
describe('SSO B2B guest — client i18n coverage', () => {
  const loginViewSource = fs.readFileSync(
    path.resolve(__dirname, '../views/LoginView.tsx'), 'utf-8',
  );
  const enSource = fs.readFileSync(
    path.resolve(__dirname, '../locales/en.ts'), 'utf-8',
  );
  const frSource = fs.readFileSync(
    path.resolve(__dirname, '../locales/fr.ts'), 'utf-8',
  );
  const nlSource = fs.readFileSync(
    path.resolve(__dirname, '../locales/nl.ts'), 'utf-8',
  );

  it('LoginView maps guest_multi_partner_mapping error code to the translated message', () => {
    expect(loginViewSource).toMatch(
      /['"]guest_multi_partner_mapping['"]\s*:\s*t\(['"]sso_guest_multi_partner_message['"]\)/,
    );
  });

  it('EN locale defines sso_guest_multi_partner_message', () => {
    expect(enSource).toMatch(/sso_guest_multi_partner_message:\s*['"]/);
  });

  it('FR locale defines sso_guest_multi_partner_message', () => {
    expect(frSource).toMatch(/sso_guest_multi_partner_message:\s*['"]/);
  });

  it('NL locale defines sso_guest_multi_partner_message', () => {
    expect(nlSource).toMatch(/sso_guest_multi_partner_message:\s*['"]/);
  });

  it('all three locales define the GUEST badge copy', () => {
    for (const src of [enSource, frSource, nlSource]) {
      expect(src).toMatch(/guest_badge:\s*['"]/);
      expect(src).toMatch(/guest_badge_tooltip:\s*['"]/);
      expect(src).toMatch(/guest_badge_aria:\s*['"]/);
    }
  });

  it('all three locales define the partner-switch confirm copy', () => {
    for (const src of [enSource, frSource, nlSource]) {
      expect(src).toMatch(/partner_switch_confirm:\s*['"]/);
    }
  });
});
