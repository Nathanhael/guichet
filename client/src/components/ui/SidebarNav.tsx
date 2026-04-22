import { ReactNode } from 'react';

interface NavButtonProps {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  role?: 'tab';
}

export function NavButton({ label, icon, active, onClick, role }: NavButtonProps) {
  return (
    <button
      role={role}
      aria-selected={role === 'tab' ? active : undefined}
      onClick={onClick}
      title={label}
      className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-[var(--radius-btn)] text-[13px] font-medium transition-colors ${
        active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function NavGroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] px-3 pt-4 pb-1.5 select-none">
      {children}
    </div>
  );
}
