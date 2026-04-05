import { useState, useRef, useEffect } from 'react';
import { useStoreShallow } from '../store/useStore';
import { usePartner } from '../hooks/usePartner';

export default function PartnerSwitcher() {
  const { memberships, activeMembershipId, setActiveMembershipId } = useStoreShallow(s => ({
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    setActiveMembershipId: s.setActiveMembershipId
  }));
  const { partnerName, isPlatformOperator } = usePartner();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
                onClick={() => {
                  setActiveMembershipId(null);
                  setIsOpen(false);
                }}
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
                onClick={() => {
                  setActiveMembershipId(m.id);
                  setIsOpen(false);
                }}
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
