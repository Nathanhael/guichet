import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { LogOut, MessageSquare, Shield } from 'lucide-react';
import useStore from '../store/useStore';
import { useT } from '../i18n';

const UserSecurityModal = lazy(() => import('./UserSecurityModal'));

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

export interface UserMenuProps {
  /** Show feedback button — agent view only. Default false. */
  showFeedback?: boolean;
  /** Show account security button — support/agent only. Default false. */
  showSecurity?: boolean;
  /** Called when user clicks the feedback item. */
  onFeedback?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function UserMenu({ showFeedback = false, showSecurity = false, onFeedback }: UserMenuProps) {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const t = useT();

  const [open, setOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside mousedown
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!user) return null;

  const initials = getInitials(user.name);

  function handleFeedback() {
    setOpen(false);
    onFeedback?.();
  }

  function handleSecurity() {
    setOpen(false);
    setSecurityOpen(true);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Avatar button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('user_menu')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="w-8 h-8 flex items-center justify-center bg-[var(--color-accent-blue)] text-white text-[10px] font-bold font-mono"
      >
        {initials}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[var(--color-bg-surface)] border border-[var(--color-border-heavy)]">
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-[var(--color-border)]">
            <div className="text-[11px] font-bold uppercase tracking-tight text-[var(--color-text-primary)]">
              {user.name}
            </div>
            <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5">{user.email}</div>
          </div>

          {/* Feedback (optional) */}
          {showFeedback && (
            <button
              onClick={handleFeedback}
              className="w-full flex items-center gap-2 px-3 py-2 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              {t('feedback')}
            </button>
          )}

          {/* Account Security (optional) */}
          {showSecurity && (
            <button
              onClick={handleSecurity}
              className="w-full flex items-center gap-2 px-3 py-2 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]"
            >
              <Shield className="h-3.5 w-3.5 shrink-0" />
              {t('account_security')}
            </button>
          )}

          {/* Sign out (always) */}
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

      {/* UserSecurityModal (lazy) */}
      {securityOpen && (
        <Suspense fallback={null}>
          <UserSecurityModal onClose={() => setSecurityOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
