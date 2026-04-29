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
   * names and badges. `prominent` is for contexts where the flag deserves
   * more attention (UserMenu self-view, ChatHeader participant row).
   */
  size?: 'inline' | 'prominent';
  /** Optional extra class names (caller-controlled spacing). */
  className?: string;
}

/**
 * "Guest" marker for Azure B2B guest users (partner employees invited into
 * our tenant). Rendered next to the user's display name in:
 *   - QueueSidebar team rows
 *   - AdminTeam row identity column
 *   - ChatHeader participant line
 *   - Message sender label (chat bubble)
 *   - UserMenu self-view
 *
 * Styling: outlined amber pill to distinguish from the solid role badges
 * (agent / support / admin) while staying within the Soft Product palette.
 */
export default function GuestBadge({ isExternal, size = 'inline', className = '' }: GuestBadgeProps) {
  const t = useT();
  if (!isExternal) return null;

  const sizeClass =
    size === 'prominent'
      ? 'text-[11px] px-2 py-0.5'
      : 'text-[10px] px-1.5 py-0.5';

  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] font-semibold border border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] leading-none ${sizeClass} ${className}`.trim()}
      title={t('guest_badge_tooltip') || 'External partner guest (B2B)'}
      aria-label={t('guest_badge_aria') || 'External guest user'}
      data-testid="guest-badge"
    >
      {t('guest_badge') || 'Guest'}
    </span>
  );
}
