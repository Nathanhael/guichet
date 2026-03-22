import { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { usePartner } from '../hooks/usePartner';

export default function PartnerSwitcher() {
  const { memberships, activeMembershipId, setActiveMembershipId } = useStore();
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
        className="flex items-center gap-2 px-3 py-1.5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 border-2 border-black dark:border-white transition-all group"
      >
        <span className="text-[10px] font-black uppercase tracking-widest truncate max-w-[120px]">
          {partnerName || 'Select Partner'}
        </span>
        <span className={`text-[8px] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {isOpen && (
        <div
          className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-black border-4 border-black dark:border-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] z-[100] overflow-hidden"
        >
          <div className="p-3 border-b-2 border-black dark:border-white bg-black dark:bg-white text-white dark:text-black">
            <span className="text-[10px] font-black uppercase tracking-widest px-2">Switch Workspace</span>
          </div>
          <div className="p-1 max-h-80 overflow-y-auto custom-scrollbar">
            {isPlatformOperator && (
              <button
                onClick={() => {
                  setActiveMembershipId(null);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-3 border-2 mb-1 transition-all flex items-center gap-3 ${
                  !activeMembershipId 
                    ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white' 
                    : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <div className="w-8 h-8 border-2 border-current flex items-center justify-center font-black">
                  P
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-tight">Platform Cockpit</p>
                  <p className="text-[8px] font-bold uppercase opacity-60">Global Management</p>
                </div>
              </button>
            )}
            
            {memberships.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setActiveMembershipId(m.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-3 border-2 mb-1 transition-all flex items-center gap-3 ${
                  activeMembershipId === m.id 
                    ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white' 
                    : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <div className="w-8 h-8 border-2 border-current flex items-center justify-center font-black text-xs">
                  {m.partnerName.charAt(0)}
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-tight">{m.partnerName}</p>
                  <p className="text-[8px] font-bold uppercase opacity-60">{m.role} · {m.manifest?.industry}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
