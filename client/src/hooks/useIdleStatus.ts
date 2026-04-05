import { useEffect, useRef } from 'react';
import { getSocket } from './useSocket';
import useStore from '../store/useStore';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Auto-sets status to 'away' after 5 minutes of inactivity.
 * Restores to 'online' when user returns.
 * Only active for support and admin roles.
 */
export function useIdleStatus() {
  const user = useStore((s) => s.user);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIdleRef = useRef(false);

  useEffect(() => {
    if (!user || (user.role !== 'support' && user.role !== 'admin')) return;

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);

      if (isIdleRef.current) {
        isIdleRef.current = false;
        getSocket().emit('status:set', { status: 'online' });
      }

      timerRef.current = setTimeout(() => {
        isIdleRef.current = true;
        getSocket().emit('status:set', { status: 'away' });
      }, IDLE_TIMEOUT_MS);
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => document.addEventListener(e, resetTimer, { passive: true }));

    function handleVisibility() {
      if (document.visibilityState === 'visible') resetTimer();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    resetTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => document.removeEventListener(e, resetTimer));
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user]);
}
