/**
 * Classifies an audit_log action string into a rendering severity so the
 * row can be highlighted. Kept in a shared module because both the
 * partner-scoped AdminAuditLog and the cross-tenant PlatformAuditLog use
 * the same scale.
 *
 *   critical — hash-chain tamper detected; platform must investigate now.
 *   warn     — a state change the security team will want to review
 *              (SSO/MFA failures, chain-verify service errors, lockouts).
 *   none     — routine, no extra emphasis.
 *
 * Adding a new action? Pick the lowest tier that still forces the right
 * eyeballs. Over-classifying numbs readers to the colour.
 */
export type AuditSeverity = 'critical' | 'warn' | 'none';

const CRITICAL = new Set<string>([
  'system.chain_broken_detected',
]);

const WARN_PREFIXES = [
  'security.',
];

const WARN_EXACT = new Set<string>([
  'system.chain_verify_error',
  'sso.email_conflict',
  'sso.no_matching_groups',
  'sso.membership_revoked',
  'auth.break_glass',
]);

export function auditSeverity(action: string): AuditSeverity {
  if (CRITICAL.has(action)) return 'critical';
  if (WARN_EXACT.has(action)) return 'warn';
  for (const prefix of WARN_PREFIXES) {
    if (action.startsWith(prefix)) return 'warn';
  }
  return 'none';
}

/**
 * Returns a left-border class matching severity. Brutalist tokens only —
 * no gradients, no fills, no radius. Just a 2px accent bar so the row
 * stays readable and the rest of the table keeps its rhythm.
 */
export function severityRowClass(severity: AuditSeverity): string {
  switch (severity) {
    case 'critical':
      return 'border-l-2 border-[var(--color-accent-red)]';
    case 'warn':
      return 'border-l-2 border-[var(--color-accent-amber)]';
    default:
      return '';
  }
}
