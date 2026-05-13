import { describe, it, expect } from 'vitest';
import { formatAuditDetails } from '../auditFormat';

// Mock translator that mirrors what locale files actually contain. This lets
// the tests validate two things at once: (1) the switch picks the right key,
// (2) the interp helper substitutes placeholders correctly. Anything not in
// this map falls through to the key string (matching the real i18n behavior),
// so an unmapped key would be visible as `audit_action_*` in the output.
const TEMPLATES: Record<string, string> = {
  audit_action_partner_created: 'Tenant created',
  audit_action_partner_config_updated: 'Tenant configuration updated',
  audit_action_partner_deactivated: 'Tenant deactivated',
  audit_action_partner_reactivated: 'Tenant reactivated',
  audit_action_partner_deleted: 'Tenant deleted',
  audit_action_platform_enter_partner: 'Platform entry into tenant {target}',
  audit_action_platform_operator_bootstrap: 'Bootstrap operator created',
  audit_action_member_added: 'Added member {who}',
  audit_action_member_invited: 'Invited {who}',
  audit_action_member_removed: 'Removed membership {who}',
  audit_action_member_removed_guest: 'Removed membership (guest) {who}',
  audit_action_member_updated: 'Role {old} -> {new}',
  audit_action_user_deleted: 'User deleted {target}',
  audit_action_user_login: 'Login from IP {ip}',
  audit_action_user_profile_updated: 'Profile updated',
  audit_action_user_sessions_revoked: 'Revoked sessions for {target}',
  audit_action_security_account_locked: 'Account locked',
  audit_action_security_mfa_disabled: 'MFA off (user)',
  audit_action_security_mfa_disabled_by_admin: 'MFA off (admin)',
  audit_action_security_mfa_enabled: 'MFA enabled',
  audit_action_security_mfa_recovery_codes_regenerated: 'Recovery codes regen',
  audit_action_security_user_unlocked_by_admin: 'Unlocked by admin',
  audit_action_sso_email_conflict: 'SSO email conflict: {email}',
  audit_action_sso_group_mapping_added: 'Mapped group {group}',
  audit_action_sso_group_mapping_updated: 'Updated mapping {target}',
  audit_action_sso_group_mapping_removed: 'Removed group {group}',
  audit_action_sso_membership_auto_created: 'Auto-created ({role})',
  audit_action_sso_no_matching_groups: 'No matching groups',
  audit_action_sso_role_synced: 'SSO role {old} -> {new}',
  audit_action_sso_membership_revoked: 'Revoked: {reason}',
  audit_action_system_archive_run: 'Archived {count} records',
  audit_action_system_gdpr_purge: 'Purged {tickets}t {messages}m',
  audit_action_label_created: 'Label: {name}',
};

const t = (key: string): string => TEMPLATES[key] ?? key;

describe('formatAuditDetails — pure (no interpolation)', () => {
  it.each([
    ['partner.created', 'Tenant created'],
    ['partner.config_updated', 'Tenant configuration updated'],
    ['partner.deactivated', 'Tenant deactivated'],
    ['partner.reactivated', 'Tenant reactivated'],
    ['partner.deleted', 'Tenant deleted'],
    ['platform_operator_bootstrap', 'Bootstrap operator created'],
    ['user.profile_updated', 'Profile updated'],
    ['security.account_locked', 'Account locked'],
    ['security.mfa_disabled', 'MFA off (user)'],
    ['security.mfa_disabled_by_admin', 'MFA off (admin)'],
    ['security.mfa_enabled', 'MFA enabled'],
    ['security.mfa_recovery_codes_regenerated', 'Recovery codes regen'],
    ['security.user_unlocked_by_admin', 'Unlocked by admin'],
    ['sso.no_matching_groups', 'No matching groups'],
  ])('%s renders the locale string verbatim', (action, expected) => {
    expect(formatAuditDetails({ action, metadata: {}, targetId: null }, t)).toBe(expected);
  });
});

describe('formatAuditDetails — single-placeholder interpolation', () => {
  it('platform.enter_partner uses targetId', () => {
    const out = formatAuditDetails(
      { action: 'platform.enter_partner', metadata: {}, targetId: 'acme' },
      t,
    );
    expect(out).toBe('Platform entry into tenant acme');
  });

  it('platform.enter_partner falls back to "-" when targetId is null', () => {
    const out = formatAuditDetails(
      { action: 'platform.enter_partner', metadata: {}, targetId: null },
      t,
    );
    expect(out).toBe('Platform entry into tenant -');
  });

  it('member.added prefers metadata.email over targetId', () => {
    const out = formatAuditDetails(
      { action: 'member.added', metadata: { email: 'a@b.com' }, targetId: 'u-1' },
      t,
    );
    expect(out).toBe('Added member a@b.com');
  });

  it('member.added falls back to targetId when email is missing', () => {
    const out = formatAuditDetails(
      { action: 'member.added', metadata: {}, targetId: 'u-1' },
      t,
    );
    expect(out).toBe('Added member u-1');
  });

  it('member.invited mirrors member.added fallback chain', () => {
    expect(
      formatAuditDetails({ action: 'member.invited', metadata: { email: 'x@y' }, targetId: null }, t),
    ).toBe('Invited x@y');
    expect(
      formatAuditDetails({ action: 'member.invited', metadata: {}, targetId: 'u-2' }, t),
    ).toBe('Invited u-2');
  });

  it('user.login prefers metadata.ip, then metadata.IP, then "-"', () => {
    expect(
      formatAuditDetails({ action: 'user.login', metadata: { ip: '1.1.1.1' }, targetId: null }, t),
    ).toBe('Login from IP 1.1.1.1');
    expect(
      formatAuditDetails({ action: 'user.login', metadata: { IP: '2.2.2.2' }, targetId: null }, t),
    ).toBe('Login from IP 2.2.2.2');
    expect(
      formatAuditDetails({ action: 'user.login', metadata: {}, targetId: null }, t),
    ).toBe('Login from IP -');
  });

  it('user.sessions_revoked uses targetId', () => {
    expect(
      formatAuditDetails({ action: 'user.sessions_revoked', metadata: {}, targetId: 'u-9' }, t),
    ).toBe('Revoked sessions for u-9');
  });

  it('sso.email_conflict, sso.group_mapping_added, sso.group_mapping_updated', () => {
    expect(
      formatAuditDetails({ action: 'sso.email_conflict', metadata: { email: 'foo@bar' }, targetId: null }, t),
    ).toBe('SSO email conflict: foo@bar');
    expect(
      formatAuditDetails({ action: 'sso.group_mapping_added', metadata: { azureGroupId: 'g-1' }, targetId: null }, t),
    ).toBe('Mapped group g-1');
    expect(
      formatAuditDetails({ action: 'sso.group_mapping_updated', metadata: {}, targetId: 'm-7' }, t),
    ).toBe('Updated mapping m-7');
    expect(
      formatAuditDetails({ action: 'sso.group_mapping_removed', metadata: { azureGroupId: 'g-2' }, targetId: null }, t),
    ).toBe('Removed group g-2');
  });

  it('sso.membership_auto_created falls back to "?" when role missing', () => {
    expect(
      formatAuditDetails({ action: 'sso.membership_auto_created', metadata: { role: 'support' }, targetId: null }, t),
    ).toBe('Auto-created (support)');
    expect(
      formatAuditDetails({ action: 'sso.membership_auto_created', metadata: {}, targetId: null }, t),
    ).toBe('Auto-created (?)');
  });

  it('sso.membership_revoked includes empty string when reason missing', () => {
    expect(
      formatAuditDetails({ action: 'sso.membership_revoked', metadata: { reason: 'inactive' }, targetId: null }, t),
    ).toBe('Revoked: inactive');
    expect(
      formatAuditDetails({ action: 'sso.membership_revoked', metadata: {}, targetId: null }, t),
    ).toBe('Revoked: ');
  });

  it('system.archive_run, label.created', () => {
    expect(
      formatAuditDetails({ action: 'system.archive_run', metadata: { count: 42 }, targetId: null }, t),
    ).toBe('Archived 42 records');
    expect(
      formatAuditDetails({ action: 'label.created', metadata: { name: 'urgent' }, targetId: null }, t),
    ).toBe('Label: urgent');
  });
});

describe('formatAuditDetails — multi-placeholder interpolation', () => {
  it('member.updated substitutes both old + new', () => {
    expect(
      formatAuditDetails(
        { action: 'member.updated', metadata: { oldRole: 'agent', newRole: 'support' }, targetId: null },
        t,
      ),
    ).toBe('Role agent -> support');
  });

  it('member.updated falls back to "?" for both when missing', () => {
    expect(
      formatAuditDetails({ action: 'member.updated', metadata: {}, targetId: null }, t),
    ).toBe('Role ? -> ?');
  });

  it('sso.role_synced mirrors member.updated', () => {
    expect(
      formatAuditDetails(
        { action: 'sso.role_synced', metadata: { oldRole: 'support', newRole: 'admin' }, targetId: null },
        t,
      ),
    ).toBe('SSO role support -> admin');
  });

  it('system.gdpr_purge substitutes both counts', () => {
    expect(
      formatAuditDetails(
        { action: 'system.gdpr_purge', metadata: { ticketsPurged: 12, messagesPurged: 340 }, targetId: null },
        t,
      ),
    ).toBe('Purged 12t 340m');
  });

  it('system.gdpr_purge falls back to "?" for missing counts', () => {
    expect(
      formatAuditDetails({ action: 'system.gdpr_purge', metadata: {}, targetId: null }, t),
    ).toBe('Purged ?t ?m');
  });
});

describe('formatAuditDetails — member.removed guest variant', () => {
  it('non-guest path uses member_removed key', () => {
    const out = formatAuditDetails(
      {
        action: 'member.removed',
        metadata: { membershipId: 'm-1' },
        targetId: null,
      },
      t,
    );
    expect(out).toBe('Removed membership m-1');
  });

  it('wasExternal=true switches to member_removed_guest key', () => {
    const out = formatAuditDetails(
      {
        action: 'member.removed',
        metadata: { membershipId: 'm-2', wasExternal: true },
        targetId: null,
      },
      t,
    );
    expect(out).toBe('Removed membership (guest) m-2');
  });

  it('wasExternal=false (not just truthy-but-not-true) keeps the non-guest path', () => {
    expect(
      formatAuditDetails(
        { action: 'member.removed', metadata: { wasExternal: 'yes', membershipId: 'm-3' }, targetId: null },
        t,
      ),
    ).toBe('Removed membership m-3');
  });

  it('falls back to targetId when membershipId is missing', () => {
    expect(
      formatAuditDetails(
        { action: 'member.removed', metadata: {}, targetId: 'u-x' },
        t,
      ),
    ).toBe('Removed membership u-x');
  });
});

describe('formatAuditDetails — default + edge cases', () => {
  it('unknown action returns JSON-serialized metadata', () => {
    const out = formatAuditDetails(
      { action: 'totally.unknown.action', metadata: { foo: 1, bar: 'baz' }, targetId: null },
      t,
    );
    expect(out).toBe('{"foo":1,"bar":"baz"}');
  });

  it('unknown action with non-object metadata serializes empty object', () => {
    const out = formatAuditDetails(
      { action: 'totally.unknown.action', metadata: 'not-an-object', targetId: null },
      t,
    );
    expect(out).toBe('{}');
  });

  it('unknown action with null metadata serializes empty object', () => {
    const out = formatAuditDetails(
      { action: 'totally.unknown.action', metadata: null, targetId: null },
      t,
    );
    expect(out).toBe('{}');
  });

  it('unmapped placeholder is left verbatim', () => {
    // Pass a t() that returns a template referencing {missing} — interp should
    // leave {missing} alone rather than producing "undefined" or empty string.
    const tWithGap = (k: string): string =>
      k === 'audit_action_partner_created' ? 'Hello {missing}' : k;
    const out = formatAuditDetails(
      { action: 'partner.created', metadata: {}, targetId: null },
      tWithGap,
    );
    expect(out).toBe('Hello {missing}');
  });
});
