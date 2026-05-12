// Shared formatter for audit-log "details" cells. Used by both PlatformAuditLog
// (cross-tenant view) and AdminAuditLog (partner-scoped view) — keeps action
// label phrasing in one place so the two panels can never drift, and makes
// every label translatable. Unmapped actions fall through to the raw metadata
// JSON, same as before, so new server-side actions still render something.

type AuditLog = {
  action: string;
  metadata?: unknown;
  targetId: string | null;
};

type T = (key: string) => string;

// Tiny {placeholder} interpolator. Kept local because i18n.ts has no
// interpolation primitive and adding one across the whole app is out of
// scope for this change. Missing keys leave the placeholder verbatim,
// which is fine — the surrounding label still reads, and the sentinel is
// easy to spot during locale review.
function interp(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export function formatAuditDetails(log: AuditLog, t: T): string {
  const m = (log.metadata && typeof log.metadata === 'object')
    ? log.metadata as Record<string, unknown>
    : {};
  const target = log.targetId || '-';
  const tt = (key: string) => t(`audit_action_${key}`);

  switch (log.action) {
    // Partner
    case 'partner.created': return tt('partner_created');
    case 'partner.config_updated': return tt('partner_config_updated');
    case 'partner.deactivated': return tt('partner_deactivated');
    case 'partner.reactivated': return tt('partner_reactivated');
    case 'partner.deleted': return tt('partner_deleted');

    // Platform
    case 'platform.enter_partner':
      return interp(tt('platform_enter_partner'), { target });
    case 'platform_operator_bootstrap':
      return tt('platform_operator_bootstrap');

    // Members
    case 'member.added':
      return interp(tt('member_added'), { who: String(m.email || target) });
    case 'member.invited':
      return interp(tt('member_invited'), { who: String(m.email || target) });
    case 'member.removed': {
      const key = m.wasExternal === true ? 'member_removed_guest' : 'member_removed';
      return interp(tt(key), { who: String(m.membershipId || target) });
    }
    case 'member.updated':
      return interp(tt('member_updated'), {
        old: String(m.oldRole || '?'),
        new: String(m.newRole || '?'),
      });

    // Users
    case 'user.deleted':
      return interp(tt('user_deleted'), { target });
    case 'user.login':
      return interp(tt('user_login'), { ip: String(m.ip || m.IP || '-') });
    case 'user.profile_updated':
      return tt('user_profile_updated');
    case 'user.sessions_revoked':
      return interp(tt('user_sessions_revoked'), { target });

    // Security
    case 'security.account_locked': return tt('security_account_locked');
    case 'security.mfa_disabled': return tt('security_mfa_disabled');
    case 'security.mfa_disabled_by_admin': return tt('security_mfa_disabled_by_admin');
    case 'security.mfa_enabled': return tt('security_mfa_enabled');
    case 'security.mfa_recovery_codes_regenerated': return tt('security_mfa_recovery_codes_regenerated');
    case 'security.user_unlocked_by_admin': return tt('security_user_unlocked_by_admin');

    // SSO
    case 'sso.email_conflict':
      return interp(tt('sso_email_conflict'), { email: String(m.email || '-') });
    case 'sso.group_mapping_added':
      return interp(tt('sso_group_mapping_added'), { group: String(m.azureGroupId || '-') });
    case 'sso.group_mapping_updated':
      return interp(tt('sso_group_mapping_updated'), { target });
    case 'sso.group_mapping_removed':
      return interp(tt('sso_group_mapping_removed'), { group: String(m.azureGroupId || '-') });
    case 'sso.membership_auto_created':
      return interp(tt('sso_membership_auto_created'), { role: String(m.role || '?') });
    case 'sso.no_matching_groups':
      return tt('sso_no_matching_groups');
    case 'sso.role_synced':
      return interp(tt('sso_role_synced'), {
        old: String(m.oldRole || '?'),
        new: String(m.newRole || '?'),
      });
    case 'sso.membership_revoked':
      return interp(tt('sso_membership_revoked'), { reason: String(m.reason || '') });

    // System
    case 'system.archive_run':
      return interp(tt('system_archive_run'), { count: String(m.count || '?') });
    case 'system.gdpr_purge':
      return interp(tt('system_gdpr_purge'), {
        tickets: String(m.ticketsPurged || '?'),
        messages: String(m.messagesPurged || '?'),
      });

    // Content
    case 'kb.created':
      return interp(tt('kb_created'), { title: String(m.title || '-') });
    case 'label.created':
      return interp(tt('label_created'), { name: String(m.name || '-') });

    default:
      return JSON.stringify(m);
  }
}
