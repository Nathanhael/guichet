import { useState, useRef, useEffect } from 'react';
import { useStoreShallow } from '../store/useStore';
import { usePartner } from '../hooks/usePartner';
import { useT } from '../i18n';

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

  /**
   * Guarded switch helper. When `confirmBeforeSwitch` is true we ask the
   * user via `window.confirm()` before mutating `activeMembershipId`.
   * Re-selecting the current workspace is a no-op and skips the prompt.
   */
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-bg-elevated hover:bg-bg-surface border border-border-heavy group"
      >
        <span className="text-[10px] font-bold uppercase tracking-widest truncate max-w-[120px]">
          {partnerName || 'Select Partner'}
        </span>
        <span className={`text-[8px] ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {isOpen && (
        <div
          className="absolute top-full left-0 mt-2 w-64 bg-bg-surface border border-border-heavy z-[100] overflow-hidden"
        >
          <div className="p-3 border-b border-border-heavy bg-bg-elevated">
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 text-text-secondary">Switch Workspace</span>
          </div>
          <div className="p-1 max-h-80 overflow-y-auto custom-scrollbar">
            {isPlatformOperator && (
              <button
                onClick={() => guardedSetActive(null)}
                className={`w-full text-left px-4 py-3 border mb-1 flex items-center gap-3 ${
                  !activeMembershipId
                    ? 'bg-accent-blue text-[var(--color-btn-text-inverse)] border-accent-blue'
                    : 'border-transparent hover:bg-bg-elevated'
                }`}
              >
                <div className="w-8 h-8 border border-current flex items-center justify-center font-bold">
                  P
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-tight">Platform Cockpit</p>
                  <p className="text-[8px] font-medium uppercase opacity-60">Global Management</p>
                </div>
              </button>
            )}
            
            {memberships.filter(m => !m.id.startsWith('platform_')).map((m) => (
              <button
                key={m.id}
                onClick={() => guardedSetActive(m.id)}
                className={`w-full text-left px-4 py-3 border mb-1 flex items-center gap-3 ${
                  activeMembershipId === m.id
                    ? 'bg-accent-blue text-[var(--color-btn-text-inverse)] border-accent-blue'
                    : 'border-transparent hover:bg-bg-elevated'
                }`}
              >
                <div className="w-8 h-8 border border-current flex items-center justify-center font-bold text-xs">
                  {m.partnerName.charAt(0)}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-tight">{m.partnerName}</p>
                  <p className="text-[8px] font-medium uppercase opacity-60">{m.role} · {m.manifest?.industry}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
