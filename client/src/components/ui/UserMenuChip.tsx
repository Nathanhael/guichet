import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  Check,
  LogOut,
  MessageSquare,
  Keyboard,
} from 'lucide-react';
import { useStoreShallow } from '../../store/useStore';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { usePartner } from '../../hooks/usePartner';
import { getSocket } from '../../hooks/useSocket';
import GuestBadge from '../GuestBadge';
import Avatar from './Avatar';

export interface UserMenuChipProps {
  /** Show online/away status quick-toggle (Support only). */
  showStatus?: boolean;
  /** Show keyboard shortcuts entry (Support only). */
  showKeyboardShortcuts?: boolean;
  onKeyboardShortcuts?: () => void;
  /** Show in-app feedback entry (Agent only). */
  showFeedback?: boolean;
  onFeedback?: () => void;
  /** Subtitle override (PlatformView uses "Platform operator"). */
  subtitleOverride?: string;
  /** Confirm before switching workspace (Support / Agent). */
  confirmBeforeSwitch?: boolean;
  /**
   * Where to anchor the dropdown.
   * - `right` (default): opens to the right of the chip, top-aligned. For sidebar use.
   * - `bottom-end`: opens below, right-aligned. For top-bar use (PlatformView).
   */
  placement?: 'right' | 'bottom-end';
}

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'fr', label: 'Francais' },
] as const;

const STATUSES = [
  { key: 'online', labelKey: 'status_online', dot: 'bg-[var(--color-ok)]' },
  { key: 'away', labelKey: 'status_away', dot: 'bg-[var(--color-accent-amber)]' },
] as const;

const SECTION =
  'text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] px-3.5 pt-3 pb-1.5 select-none';
const ROW = 'flex items-center justify-between gap-4 px-3.5 py-2.5';
const LABEL = 'text-[12px] font-medium text-[var(--color-ink)]';

function ToggleSwitch({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={`relative w-9 h-5 rounded-[var(--radius-pill)] shrink-0 transition-colors ${
        enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-elevated)]'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-bg-surface)] shadow-[var(--shadow-soft)] transition-[left] ${
          enabled ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export default function UserMenuChip({
  showStatus = false,
  showKeyboardShortcuts = false,
  onKeyboardShortcuts,
  showFeedback = false,
  onFeedback,
  subtitleOverride,
  confirmBeforeSwitch = false,
  placement = 'right',
}: UserMenuChipProps) {
  const t = useT();
  const { partnerName, isPlatformOperator } = usePartner();

  const {
    user, memberships, activeMembershipId, setActiveMembershipId,
    darkMode, toggleDarkMode,
    selectedLang, setSelectedLang,
    agentStatus, setAgentStatus,
    dyslexicMode, toggleDyslexicMode,
    bionicReading, toggleBionicReading,
    monochromeMode, toggleMonochromeMode,
    focusMode, toggleFocusMode,
    logout,
  } = useStoreShallow(s => ({
    user: s.user,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    setActiveMembershipId: s.setActiveMembershipId,
    darkMode: s.darkMode,
    toggleDarkMode: s.toggleDarkMode,
    selectedLang: s.selectedLang,
    setSelectedLang: s.setSelectedLang,
    agentStatus: s.agentStatus,
    setAgentStatus: s.setAgentStatus,
    dyslexicMode: s.dyslexicMode,
    toggleDyslexicMode: s.toggleDyslexicMode,
    bionicReading: s.bionicReading,
    toggleBionicReading: s.toggleBionicReading,
    monochromeMode: s.monochromeMode,
    toggleMonochromeMode: s.toggleMonochromeMode,
    focusMode: s.focusMode,
    toggleFocusMode: s.toggleFocusMode,
    logout: s.logout,
  }));

  const utils = trpc.useUtils();
  const localeInfoQuery = trpc.user.getLocaleInfo.useQuery(undefined, { enabled: !!user });
  const setLocale = trpc.user.setLocale.useMutation({
    onSuccess: () => utils.user.getLocaleInfo.invalidate(),
  });
  const currentLang = selectedLang || user?.lang || 'en';
  const info = localeInfoQuery.data;
  const showLangSsoBadge = !!user && !!info?.hasSso && !info.langLocked;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // Fixed-position popover: clears cached position on close and recomputes
  // from the trigger rect on open. setState is how we communicate layout
  // back to React; unavoidable for portal-positioned overlays.
  useLayoutEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMenuPos(null);
      return;
    }
    function compute() {
      const btn = containerRef.current?.querySelector('button');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const MENU_W = 280;
      const GAP = 8;
      const margin = 8;
      let top: number;
      let left: number;
      if (placement === 'bottom-end') {
        top = r.bottom + GAP;
        left = r.right - MENU_W;
      } else {
        top = r.top;
        left = r.right + GAP;
        if (left + MENU_W > window.innerWidth - margin) {
          left = r.left - MENU_W - GAP;
        }
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - MENU_W - margin));
      top = Math.max(margin, top);
      setMenuPos({ top, left });
    }
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, placement]);

  // Global Ctrl+Shift+F focus-mode toggle (relocated from deprecated AccessibilityMenu).
  const handleGlobalKeyboard = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        toggleFocusMode();
      }
    },
    [toggleFocusMode],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyboard);
    return () => document.removeEventListener('keydown', handleGlobalKeyboard);
  }, [handleGlobalKeyboard]);

  // Support-only: sync Zustand agentStatus from socket `status:restored`
  // (fires on reconnect to preserve prior away state across socket drops).
  useEffect(() => {
    if (!showStatus) return;
    const socket = getSocket();
    if (!socket) return;
    const onRestored = ({ status }: { status: string }) => {
      if (STATUSES.some((s) => s.key === status)) setAgentStatus(status);
    };
    socket.on('status:restored', onRestored);
    return () => {
      socket.off('status:restored', onRestored);
    };
  }, [showStatus, setAgentStatus]);

  // Support-only: Ctrl+. hotkey dispatches `support:open-status-picker`.
  // Open the chip dropdown so the status quick-toggles are visible.
  useEffect(() => {
    if (!showStatus) return;
    function handler() {
      setOpen(true);
    }
    window.addEventListener('support:open-status-picker', handler);
    return () => window.removeEventListener('support:open-status-picker', handler);
  }, [showStatus]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const subtitle = subtitleOverride ?? partnerName;
  const nonPlatformMemberships = memberships.filter(m => !m.id.startsWith('platform_'));
  const workspaceSwitchable = nonPlatformMemberships.length > 1 || isPlatformOperator;

  function handleLangPick(code: 'en' | 'nl' | 'fr') {
    setSelectedLang(code);
    if (user && info?.hasSso) setLocale.mutate({ lang: code, lockFromSso: true });
    else if (user) setLocale.mutate({ lang: code });
  }

  function handleStatusPick(newStatus: string) {
    setAgentStatus(newStatus);
    if (user) getSocket()?.emit('status:set', { status: newStatus });
  }

  function handleWorkspaceSwitch(nextId: string | null) {
    if (nextId === activeMembershipId) {
      setOpen(false);
      return;
    }
    if (confirmBeforeSwitch) {
      const proceed = window.confirm(
        t('partner_switch_confirm') ||
          'Switch tenant? Open chats and unsaved drafts will be lost.',
      );
      if (!proceed) {
        setOpen(false);
        return;
      }
    }
    setActiveMembershipId(nextId);
    setOpen(false);
  }

  function handleFeedback() {
    setOpen(false);
    onFeedback?.();
  }

  function handleKeyboardShortcuts() {
    setOpen(false);
    onKeyboardShortcuts?.();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={t('user_menu')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={user.name}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-btn)] hover:bg-[var(--color-hover)] transition-colors text-left"
      >
        <Avatar name={user.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--color-ink)] truncate flex items-center gap-1.5">
            <span className="truncate">{user.name}</span>
          </div>
          <div className="text-[11px] text-[var(--color-ink-muted)] truncate">
            {subtitle}
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`text-[var(--color-ink-muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label={t('user_menu')}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          className="z-50 w-[280px] bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] max-h-[calc(100vh-32px)] overflow-y-auto custom-scrollbar"
        >
          <div className="px-3.5 py-3 border-b border-[var(--color-border)] flex items-center gap-3">
            <Avatar name={user.name} size={40} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[var(--color-ink)] flex items-center gap-2 truncate">
                <span className="truncate">{user.name}</span>
                <GuestBadge isExternal={user.isExternal} size="prominent" />
              </div>
              <div className="text-[11px] text-[var(--color-ink-muted)] truncate mt-0.5">
                {user.email}
              </div>
            </div>
          </div>

          {showStatus && (
            <div className="border-b border-[var(--color-border)]">
              <div className={SECTION}>{t('status') || 'Status'}</div>
              <div className="px-3.5 pb-2.5 flex gap-1.5">
                {STATUSES.map(s => {
                  const active = agentStatus === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => handleStatusPick(s.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[var(--radius-btn)] text-[12px] font-medium transition-colors ${
                        active
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                      <span>{t(s.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {workspaceSwitchable && (
            <div className="border-b border-[var(--color-border)]">
              <div className={SECTION}>{t('switch_workspace') || 'Workspace'}</div>
              <div className="px-1.5 pb-2 flex flex-col gap-0.5">
                {isPlatformOperator && (() => {
                  const active = !activeMembershipId;
                  return (
                    <button
                      onClick={() => handleWorkspaceSwitch(null)}
                      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-[var(--radius-btn)] transition-colors text-left ${
                        active ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-hover)]'
                      }`}
                    >
                      <Avatar name="Platform" size={28} color="var(--color-accent)" />
                      <div className="min-w-0 flex-1">
                        <div className={`text-[12.5px] font-medium truncate ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink)]'}`}>
                          Platform Cockpit
                        </div>
                        <div className="text-[10.5px] text-[var(--color-ink-muted)] truncate">
                          Global management
                        </div>
                      </div>
                      {active && <Check size={14} className="text-[var(--color-accent)] shrink-0" />}
                    </button>
                  );
                })()}
                {nonPlatformMemberships.map(m => {
                  const active = activeMembershipId === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => handleWorkspaceSwitch(m.id)}
                      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-[var(--radius-btn)] transition-colors text-left ${
                        active ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-hover)]'
                      }`}
                    >
                      <Avatar name={m.partnerName} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className={`text-[12.5px] font-medium truncate ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink)]'}`}>
                          {m.partnerName}
                        </div>
                        <div className="text-[10.5px] text-[var(--color-ink-muted)] truncate">
                          {m.role}{m.manifest?.industry ? ` · ${m.manifest.industry}` : ''}
                        </div>
                      </div>
                      {active && <Check size={14} className="text-[var(--color-accent)] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className={ROW}>
            <span className={LABEL}>{darkMode ? t('light_mode') : t('dark_mode')}</span>
            <ToggleSwitch
              enabled={darkMode}
              onToggle={toggleDarkMode}
              label={darkMode ? t('light_mode') : t('dark_mode')}
            />
          </div>

          <div className="border-b border-[var(--color-border)] px-3.5 py-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <span className={LABEL}>{t('language')}</span>
              {showLangSsoBadge && (
                <span className="text-[10px] text-[var(--color-ink-muted)]">
                  Synced from SSO
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => handleLangPick(lang.code)}
                  className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-[var(--radius-btn)] transition-colors ${
                    currentLang === lang.code
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          <div className={SECTION}>{t('accessibility')}</div>
          <div className={ROW}>
            <span className={LABEL}>{t('dyslexic_font')}</span>
            <ToggleSwitch
              enabled={dyslexicMode}
              onToggle={toggleDyslexicMode}
              label={t('dyslexic_font')}
            />
          </div>
          <div className={ROW}>
            <span className={LABEL}>{t('bionic_reading')}</span>
            <ToggleSwitch
              enabled={bionicReading}
              onToggle={toggleBionicReading}
              label={t('bionic_reading')}
            />
          </div>
          <div className={ROW}>
            <span className={LABEL}>{t('monochrome')}</span>
            <ToggleSwitch
              enabled={monochromeMode}
              onToggle={toggleMonochromeMode}
              label={t('monochrome')}
            />
          </div>
          <div className="border-b border-[var(--color-border)] px-3.5 py-2.5 flex items-center justify-between gap-4">
            <div className="flex flex-col min-w-0">
              <span className={LABEL}>{t('focus_mode') || 'Focus mode'}</span>
              <span className="text-[10px] text-[var(--color-ink-muted)]">
                Ctrl+Shift+F
              </span>
            </div>
            <ToggleSwitch
              enabled={focusMode}
              onToggle={toggleFocusMode}
              label={t('focus_mode') || 'Focus mode'}
            />
          </div>

          {showKeyboardShortcuts && (
            <button
              onClick={handleKeyboardShortcuts}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            >
              <Keyboard className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" />
              {t('keyboard_shortcuts') || 'Keyboard shortcuts'}
            </button>
          )}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
