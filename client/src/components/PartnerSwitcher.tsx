import { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import { usePartner } from '../hooks/usePartner';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Globe } from 'lucide-react';

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
        className="flex items-center gap-2 px-3 py-1.5 bg-black/10 dark:bg-white/5 hover:bg-black/20 dark:hover:bg-white/10 rounded-xl border border-white/10 transition-all group"
      >
        <div className="w-5 h-5 rounded-lg bg-brand-500/20 flex items-center justify-center border border-brand-500/30">
          <Globe size={12} className="text-brand-400" />
        </div>
        <span className="text-xs font-bold text-gray-300 group-hover:text-white transition-colors truncate max-w-[100px]">
          {partnerName}
        </span>
        <ChevronDown size={14} className={`text-gray-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute top-full left-0 mt-2 w-56 bg-brand-900 border border-white/10 rounded-2xl shadow-2xl z-[100] overflow-hidden"
          >
            <div className="p-3 border-b border-white/5 bg-white/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 px-2">Switch Project</span>
            </div>
            <div className="p-1 max-h-64 overflow-y-auto custom-scrollbar">
              {isPlatformOperator && (
                <button
                  onClick={() => {
                    setActiveMembershipId(null);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-3 ${
                    !activeMembershipId ? 'bg-accent-500/20 text-accent-400' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-accent-500/10 border border-accent-500/20 flex items-center justify-center font-bold">
                    P
                  </div>
                  <div>
                    <p className="text-xs font-bold">Platform Cockpit</p>
                    <p className="text-[10px] opacity-60">Global Management</p>
                  </div>
                </button>
              )}
              
              {memberships.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setActiveMembershipId(m.id);
                    setIsOpen(false);
                    // In a full implementation, we'd call /switch-partner to get a new token
                    // For now, setting the state is enough if the manifest is already in membership
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-3 ${
                    activeMembershipId === m.id ? 'bg-brand-500/20 text-brand-400' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div 
                    className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs"
                    style={{ backgroundColor: m.manifest.primaryColor + '22', color: m.manifest.primaryColor, border: `1px solid ${m.manifest.primaryColor}44` }}
                  >
                    {m.partnerName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-xs font-bold">{m.partnerName}</p>
                    <p className="text-[10px] opacity-60 capitalize">{m.role} · {m.manifest.industry}</p>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
