import type { ReactNode, MouseEvent, KeyboardEvent } from 'react';
import { useIsExternalAdmin } from '../hooks/useIsExternalAdmin';
import { useT } from '../i18n';

interface ExternalGuestGuardProps {
  children: ReactNode;
  /**
   * Use the short tooltip for tight UI spots (e.g. icon buttons in a toolbar).
   * Defaults to the full tooltip.
   */
  short?: boolean;
  /**
   * Optional className passthrough for the wrapper span.
   * The caller's children keep their own styles; the wrapper only layers
   * on aria-disabled, the tooltip, and pointer swallowing.
   */
  className?: string;
}

/**
 * Wraps destructive admin controls so Azure B2B guests see them as
 * disabled-with-tooltip instead of hitting a server FORBIDDEN response.
 *
 * Backend source of truth is `destructiveAdminProcedure`; this wrapper is
 * UX polish and defense-in-depth only. When the viewer is internal, it
 * renders its children unchanged and adds no DOM nodes around them.
 */
export default function ExternalGuestGuard({ children, short, className }: ExternalGuestGuardProps) {
  const isExternal = useIsExternalAdmin();
  const t = useT();

  if (!isExternal) {
    return <>{children}</>;
  }

  const tooltip = short ? t('guest_admin_disabled_tooltip_short') : t('guest_admin_disabled_tooltip');

  const swallow = (e: MouseEvent | KeyboardEvent) => {
    // Block clicks / keyboard activation from reaching children. The native
    // `disabled` attribute on a wrapped <button> is set via disabledIfExternal;
    // this stopgap also covers non-button children (labels, divs with onClick).
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      swallow(e);
    }
  };

  return (
    <span
      aria-disabled="true"
      title={tooltip}
      data-guest-disabled="true"
      className={`inline-block opacity-40 cursor-not-allowed ${className ?? ''}`.trim()}
      onClickCapture={swallow}
      onKeyDownCapture={onKeyDown}
    >
      {children}
    </span>
  );
}
