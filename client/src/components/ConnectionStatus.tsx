import { useEffect, useRef } from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';

/**
 * Displays a dot + label when the socket connection is disconnected or reconnecting.
 * Renders nothing when connected, or during the initial connect (before we've ever been connected).
 */
export default function ConnectionStatus() {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const t = useT();
  const hasConnected = useRef(false);

  useEffect(() => {
    if (connectionStatus === 'connected') {
      hasConnected.current = true;
    }
  }, [connectionStatus]);

  if (connectionStatus === 'connected') return null;
  // Intentional ref read in render: "have we ever connected" is a render
  // gate, not render data. Promoting to state would trigger an extra
  // re-render on first connect for no user-visible benefit.
  // eslint-disable-next-line react-hooks/refs
  if (!hasConnected.current) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-ink-soft)]">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          connectionStatus === 'reconnecting' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-urgent)]'
        }`}
      />
      {t(`connection_${connectionStatus}`)}
    </span>
  );
}
