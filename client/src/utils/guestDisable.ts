/**
 * Shared prop bag for form controls that must be visibly disabled when the
 * current user is an Azure B2B guest. The backend (destructiveAdminProcedure)
 * is the source of truth — this helper is UX + defense-in-depth.
 *
 * Parent: docs/superpowers/plans/2026-04-17-guest-admin-visible-disable.md
 */
export function disabledIfExternal(
  isExternal: boolean,
  tooltip: string,
): { disabled: boolean; title?: string; 'aria-disabled'?: true } {
  if (!isExternal) return { disabled: false };
  return {
    disabled: true,
    title: tooltip,
    'aria-disabled': true,
  };
}
