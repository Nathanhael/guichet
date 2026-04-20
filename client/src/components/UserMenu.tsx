import { useEffect, useRef, useState } from 'react';
import { LogOut, MessageSquare, ChevronDown } from 'lucide-react';
import useStore from '../store/useStore';
import { useT } from '../i18n';
import GuestBadge from './GuestBadge';
import Avatar from './ui/Avatar';

export interface UserMenuProps {
  /** Show feedback button — agent view only. Default false. */
  showFeedback?: boolean;
  /** Called when user clicks the feedback item. */
  onFeedback?: () => void;
}

export default function UserMenu({ showFeedback = false, onFeedback }: UserMenuProps) {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const t = useT();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!user) return null;

  function handleFeedback() {
    setOpen(false);
    onFeedback?.();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('user_menu')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={user.name}
        className="h-9 pl-1 pr-2.5 flex items-center gap-2 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] transition-colors max-w-[220px]"
      >
        <Avatar name={user.name} size={28} />
        <span className="text-[13px] font-medium text-[var(--color-ink)] truncate">
          {user.name}
        </span>
        <ChevronDown size={14} className="text-[var(--color-ink-muted)] shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-60 bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] overflow-hidden">
          <div className="px-3.5 py-3 border-b border-[var(--color-border)] flex items-center gap-3">
            <Avatar name={user.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[var(--color-ink)] flex items-center gap-2 truncate">
                <span className="truncate">{user.name}</span>
                <GuestBadge isExternal={user.isExternal} size="prominent" />
              </div>
              <div className="text-[11px] text-[var(--color-ink-muted)] truncate mt-0.5">{user.email}</div>
            </div>
          </div>

          {showFeedback && (
            <button
              onClick={handleFeedback}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" />
              {t('feedback')}
            </button>
          )}

          <button
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-[var(--color-urgent)] hover:bg-[var(--color-urgent-soft)]"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {t('sign_out')}
          </button>
        </div>
      )}
    </div>
  );
}
