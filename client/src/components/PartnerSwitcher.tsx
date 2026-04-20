import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useStoreShallow } from '../store/useStore';
import { usePartner } from '../hooks/usePartner';
import { useT } from '../i18n';
import Avatar from './ui/Avatar';

export interface PartnerSwitcherProps {
  /**
   * Show a browser confirm dialog before switching.
   *
   * AdminView historically switches silently (no in-flight user data at risk
   * beyond form state that is persisted as-you-go), so the default stays
   * false for backward compatibility.
   *
   * AgentView and SupportView should pass `true`: switching reconnects the
   * socket and drops open tickets / unsaved drafts that are held only in
   * local component state (not yet in Zustand). A confirm is the minimal
   * safety net until per-view dirty tracking lands.
   *
   * See docs/superpowers/plans/2026-04-16-partner-sso-b2b-guest.md Task 6.
   */
  confirmBeforeSwitch?: boolean;
}

export default function PartnerSwitcher({ confirmBeforeSwitch = false }: PartnerSwitcherProps) {
  const { memberships, activeMembershipId, setActiveMembershipId } = useStoreShallow(s => ({
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    setActiveMembershipId: s.setActiveMembershipId
  }));
  const { partnerName, isPlatformOperator } = usePartner();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (memberships.length <= 1 && !isPlatformOperator) return null;

  const guardedSetActive = (nextId: string | null) => {
    if (nextId === activeMembershipId) {
      setIsOpen(false);
      return;
    }
    if (confirmBeforeSwitch) {
      const proceed = window.confirm(
        t('partner_switch_confirm') ||
          'Switch tenant? Open chats and unsaved drafts will be lost.',
      );
      if (!proceed) {
        setIsOpen(false);
        return;
      }
    }
    setActiveMembershipId(nextId);
    setIsOpen(false);
  };

  const displayName = partnerName || 'Select Partner';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 h-9 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <span className="text-[13px] font-medium text-[var(--color-ink)] truncate max-w-[140px]">
          {displayName}
        </span>
        <ChevronDown
          size={14}
          className={`text-[var(--color-ink-muted)] shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-72 bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] z-[100] overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[var(--color-border)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
              {t('switch_workspace') || 'Switch workspace'}
            </span>
          </div>
          <div className="p-1 max-h-80 overflow-y-auto custom-scrollbar">
            {isPlatformOperator && (() => {
              const isActive = !activeMembershipId;
              return (
                <button
                  onClick={() => guardedSetActive(null)}
                  className={`w-full text-left px-2.5 py-2 rounded-[var(--radius-btn)] mb-0.5 flex items-center gap-3 transition-colors ${
                    isActive
                      ? 'bg-[var(--color-accent-soft)]'
                      : 'hover:bg-[var(--color-hover)]'
                  }`}
                >
                  <Avatar name="Platform" size={32} color="var(--color-accent)" />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] font-medium truncate ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink)]'}`}>
                      Platform Cockpit
                    </p>
                    <p className="text-[11px] text-[var(--color-ink-muted)] truncate">Global management</p>
                  </div>
                  {isActive && <Check size={14} className="text-[var(--color-accent)] shrink-0" />}
                </button>
              );
            })()}

            {memberships.filter(m => !m.id.startsWith('platform_')).map((m) => {
              const isActive = activeMembershipId === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => guardedSetActive(m.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-[var(--radius-btn)] mb-0.5 flex items-center gap-3 transition-colors ${
                    isActive
                      ? 'bg-[var(--color-accent-soft)]'
                      : 'hover:bg-[var(--color-hover)]'
                  }`}
                >
                  <Avatar name={m.partnerName} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] font-medium truncate ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink)]'}`}>
                      {m.partnerName}
                    </p>
                    <p className="text-[11px] text-[var(--color-ink-muted)] truncate">
                      {m.role}{m.manifest?.industry ? ` · ${m.manifest.industry}` : ''}
                    </p>
                  </div>
                  {isActive && <Check size={14} className="text-[var(--color-accent)] shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
