import { useEffect, useRef, useState } from 'react';
import { LogOut, MessageSquare } from 'lucide-react';
import useStore from '../store/useStore';
import { useT } from '../i18n';
import GuestBadge from './GuestBadge';

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
        className="h-8 px-3 flex items-center justify-center bg-[var(--color-accent-blue)] text-[var(--color-btn-text-inverse)] text-[10px] font-bold font-mono uppercase tracking-[0.12em] whitespace-nowrap max-w-[220px] truncate"
      >
        {user.name}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[var(--color-bg-surface)] border border-[var(--color-border-heavy)]">
          <div className="px-3 py-2.5 border-b border-[var(--color-border)]">
            <div className="text-[11px] font-bold uppercase tracking-tight text-[var(--color-text-primary)] flex items-center gap-2">
              <span className="truncate">{user.name}</span>
              <GuestBadge isExternal={user.isExternal} size="prominent" />
            </div>
            <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5">{user.email}</div>
          </div>

          {showFeedback && (
            <button
              onClick={handleFeedback}
              className="w-full flex items-center gap-2 px-3 py-2 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              {t('feedback')}
            </button>
          )}

          <button
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-accent-red)] hover:bg-[var(--color-bg-elevated)]"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            {t('sign_out')}
          </button>
        </div>
      )}
    </div>
  );
}
