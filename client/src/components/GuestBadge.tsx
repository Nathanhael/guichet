import { useT } from '../i18n';

interface GuestBadgeProps {
  /**
   * Whether the user represented is an Azure B2B guest. If falsy (undefined
   * or false) the component renders nothing, making it safe to drop into any
   * list without extra conditionals at the call site.
   */
  isExternal?: boolean;
  /**
   * Visual weight. `inline` (default) is the compact variant used inside
   * names and badges — ~9px, tight padding. `prominent` is for contexts
   * where the flag deserves more attention (UserMenu self-view, ChatHeader
   * participant row). Both use the brutalist token palette.
   */
  size?: 'inline' | 'prominent';
  /** Optional extra class names (caller-controlled spacing). */
  className?: string;
}

/**
 * Brutalist "GUEST" marker for Azure B2B guest users (partner employees
 * invited into our tenant). Rendered next to the user's display name in:
 *   - QueueSidebar team rows
 *   - AdminTeam row identity column
 *   - ChatHeader participant line
 *   - MessageBubble sender label
 *   - UserMenu self-view
 *
 * See docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md Task 5.
 *
 * Styling: outline border + amber accent to distinguish from the solid
 * role badges (AGENT/SUPPORT/ADMIN) while keeping the brutalist token
 * palette (no radius, no shadow, mono uppercase).
 */
export default function GuestBadge({ isExternal, size = 'inline', className = '' }: GuestBadgeProps) {
  const t = useT();
  if (!isExternal) return null;

  const sizeClass =
    size === 'prominent'
      ? 'text-[10px] px-2 py-0.5 tracking-[2px]'
      : 'text-[9px] px-1.5 py-0.5 tracking-wide';

  return (
    <span
      className={`inline-block font-mono font-bold uppercase border border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] ${sizeClass} ${className}`.trim()}
      title={t('guest_badge_tooltip') || 'External partner guest (B2B)'}
      aria-label={t('guest_badge_aria') || 'External guest user'}
      data-testid="guest-badge"
    >
      {t('guest_badge') || 'GUEST'}
    </span>
  );
}
