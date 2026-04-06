import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ResizablePanelProps {
  /** Which side of the layout this panel is on */
  side: 'left' | 'right';
  /** Default width in pixels */
  defaultWidth: number;
  /** Minimum width when resizing */
  minWidth: number;
  /** Maximum width when resizing */
  maxWidth: number;
  /** localStorage key for persisting width */
  storageKey: string;
  /** Whether the panel is expanded */
  isOpen: boolean;
  /** Toggle expanded/collapsed */
  onToggle: () => void;
  /** Vertical label shown when collapsed */
  collapsedLabel?: string;
  /** Badge number shown when collapsed */
  collapsedBadge?: number;
  /** Icon shown in collapsed strip */
  collapsedIcon?: ReactNode;
  /** Tooltip for toggle button */
  toggleTitle?: string;
  children: ReactNode;
}

export default function ResizablePanel({
  side,
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  isOpen,
  onToggle,
  collapsedLabel,
  collapsedBadge,
  collapsedIcon,
  toggleTitle,
  children,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed)) return Math.max(minWidth, Math.min(maxWidth, parsed));
    }
    return defaultWidth;
  });
  const widthRef = useRef(width);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Keep ref in sync for mouseUp persistence
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };
      setIsDragging(true);
    },
    [width],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      const newWidth =
        side === 'left'
          ? dragRef.current.startWidth + delta
          : dragRef.current.startWidth - delta;
      setWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem(storageKey, String(widthRef.current));
      dragRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging, side, minWidth, maxWidth, storageKey]);

  const ExpandIcon = side === 'left' ? ChevronRight : ChevronLeft;

  // ── Collapsed strip ──
  if (!isOpen) {
    return (
      <div
        className={`shrink-0 w-10 bg-[var(--color-bg-surface)] flex flex-col ${
          side === 'left' ? 'border-r' : 'border-l'
        } border-[var(--color-border)]`}
      >
        <button
          onClick={onToggle}
          className="h-full min-w-10 flex flex-col items-center py-3 gap-2 hover:bg-[var(--color-bg-base)]"
          title={toggleTitle}
        >
          <ExpandIcon className="h-3.5 w-3.5 opacity-40" />
          {collapsedBadge != null && collapsedBadge > 0 && (
            <span className="text-[10px] font-bold tabular-nums text-[var(--color-accent-blue)]">
              {collapsedBadge}
            </span>
          )}
          {collapsedIcon}
          {collapsedLabel && (
            <span
              className="font-mono text-[8px] font-bold uppercase tracking-[0.2em] opacity-20 mt-1"
              style={{ writingMode: 'vertical-rl' }}
            >
              {collapsedLabel}
            </span>
          )}
        </button>
      </div>
    );
  }

  // ── Expanded with resize handle ──
  return (
    <div
      className={`shrink-0 relative bg-[var(--color-bg-surface)] flex flex-col overflow-hidden ${
        side === 'left'
          ? 'border-r border-[var(--color-border)] max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40'
          : 'border-l border-[var(--color-border)]'
      }`}
      style={{ width }}
    >
      {children}

      {/* Drag handle — double-click to collapse */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={onToggle}
        className={`absolute top-0 bottom-0 w-1 z-10 cursor-col-resize transition-colors duration-75 ${
          side === 'left' ? 'right-0' : 'left-0'
        } ${isDragging ? 'bg-[var(--color-accent-blue)]' : 'hover:bg-[var(--color-border)]'}`}
      />
    </div>
  );
}
