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

  // Don't flash "disconnected" before the socket has ever connected
  if (!hasConnected.current) return null;

  return (
    <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          connectionStatus === 'reconnecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
        }`}
      />
      {t(`connection_${connectionStatus}`)}
    </span>
  );
}
