/**
 * Shared prop bag for form controls that must be visibly disabled when the
 * current user is an Azure B2B guest. The backend (destructiveAdminProcedure)
 * is the source of truth — this helper is UX + defense-in-depth.
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
