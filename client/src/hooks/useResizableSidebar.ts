import { useCallback, useEffect, useRef, useState } from 'react';

type ResizableSidebarOptions = {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
};

type ResizableSidebarApi = {
  width: number;
  onDragStart: (e: React.MouseEvent<HTMLDivElement>) => void;
};

// Sidebar width persistence + drag-to-resize, hand-rolled identically across
// PlatformView, AdminView, and AgentView. Owns the localStorage round-trip,
// the min/max clamp, and the global mousemove/mouseup listeners attached for
// the duration of a drag.
export function useResizableSidebar({
  storageKey,
  defaultWidth,
  min,
  max,
}: ResizableSidebarOptions): ResizableSidebarApi {
  const readInitial = useCallback((): number => {
    if (typeof window === 'undefined') return defaultWidth;
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return defaultWidth;
    return Math.min(max, Math.max(min, parsed));
  }, [storageKey, defaultWidth, min, max]);

  const [width, setWidth] = useState<number>(readInitial);
  // widthRef tracks the currently-committed width so the global mousemove
  // listener (registered once) reads the latest value via closure. We update
  // it inside the mousemove handler whenever we call setWidth, so the ref
  // stays in sync without a render-time assignment.
  const widthRef = useRef(width);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = { startX: e.clientX, startWidth: widthRef.current };
    e.preventDefault();
  }, []);

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      const drag = dragStateRef.current;
      if (!drag) return;
      const next = drag.startWidth + (e.clientX - drag.startX);
      const clamped = Math.min(max, Math.max(min, next));
      widthRef.current = clamped;
      setWidth(clamped);
    }
    function handleUp() {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      try {
        window.localStorage.setItem(storageKey, String(widthRef.current));
      } catch {
        // storage disabled (private browsing, quota, etc.) — width still
        // applies for the current session.
      }
    }
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [storageKey, min, max]);

  return { width, onDragStart };
}
