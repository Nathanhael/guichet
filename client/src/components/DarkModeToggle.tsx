import { Sun, Moon } from 'lucide-react';
import { useStoreShallow } from '../store/useStore';

export default function DarkModeToggle() {
  const { darkMode, toggleDarkMode } = useStoreShallow(s => ({
    darkMode: s.darkMode,
    toggleDarkMode: s.toggleDarkMode
  }));

  return (
    <button
      onClick={toggleDarkMode}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-btn)] border border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)] transition-colors"
      title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {darkMode ? <Sun className="h-3.5 w-3.5" strokeWidth={2} /> : <Moon className="h-3.5 w-3.5" strokeWidth={2} />}
    </button>
  );
}
