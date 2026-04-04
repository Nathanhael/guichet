import { useEffect, useRef } from 'react';
import { getSocket } from './useSocket';
import useStore from '../store/useStore';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Auto-sets status to 'break' after 5 minutes of inactivity.
 * Restores previous status when user returns.
 * Only active for support and admin roles.
 */
export function useIdleStatus() {
  const user = useStore((s) => s.user);
  const agentStatus = useStore((s) => s.agentStatus);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIdleRef = useRef(false);
  const previousStatusRef = useRef('available');
  const currentStatusRef = useRef(agentStatus);

  // Keep ref in sync without triggering the main effect
  useEffect(() => {
    if (!isIdleRef.current) {
      currentStatusRef.current = agentStatus;
    }
  }, [agentStatus]);

  useEffect(() => {
    if (!user || (user.role !== 'support' && user.role !== 'admin')) return;

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);

      if (isIdleRef.current) {
        isIdleRef.current = false;
        getSocket().emit('status:set', { status: previousStatusRef.current });
      }

      timerRef.current = setTimeout(() => {
        previousStatusRef.current = currentStatusRef.current;
        isIdleRef.current = true;
        getSocket().emit('status:set', { status: 'break' });
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
