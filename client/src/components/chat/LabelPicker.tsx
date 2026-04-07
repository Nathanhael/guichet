import { useState, useRef, useEffect } from 'react';
import { getSocket } from '../../hooks/useSocket';
import { useT } from '../../i18n';
import { Label } from '../../types';
import { COLOR_BG_MAP } from '../../utils/labelColors';
import { Plus, Check } from 'lucide-react';

interface LabelPickerProps {
  ticketId: string;
  currentLabels: string[];
  allLabels: Label[];
}

export default function LabelPicker({ ticketId, currentLabels, allLabels }: LabelPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [optimisticLabels, setOptimisticLabels] = useState<string[]>(currentLabels);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOptimisticLabels(currentLabels); }, [currentLabels]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const MAX_LABELS = 50;

  function toggleLabel(labelId: string) {
    const isRemoving = optimisticLabels.includes(labelId);
    if (!isRemoving && optimisticLabels.length >= MAX_LABELS) return;
    const newLabels = isRemoving
      ? optimisticLabels.filter((id) => id !== labelId)
      : [...optimisticLabels, labelId];
    setOptimisticLabels(newLabels);
    getSocket().emit('ticket:labels:update', { ticketId, labels: newLabels });
  }

  const atLimit = optimisticLabels.length >= MAX_LABELS;

  if (allLabels.length === 0) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest bg-bg-elevated text-text-secondary border border-border-heavy hover:text-text-primary"
        aria-label={t('add_label') || 'Add label'}
      >
        <Plus size={10} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-bg-surface border border-border-heavy z-50 min-w-[180px] max-h-[200px] overflow-y-auto animate-fade-in">
          {allLabels.map((label) => {
            const isActive = optimisticLabels.includes(label.id);
            const bgClass = COLOR_BG_MAP[label.color] || 'bg-slate-500';
            return (
              <button
                key={label.id}
                onClick={() => toggleLabel(label.id)}
                disabled={atLimit && !isActive}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${atLimit && !isActive ? 'opacity-30 cursor-not-allowed' : 'hover:bg-bg-elevated'}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${bgClass}`} />
                <span className="font-mono text-[10px] text-text-primary flex-1 truncate">{label.name}</span>
                {isActive && <Check size={12} className="text-accent-blue shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
