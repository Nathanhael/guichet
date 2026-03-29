import { useEffect, useRef } from 'react';
import useStore from '../store/useStore';

/** Seconds before expiry to trigger a refresh */
const REFRESH_BUFFER_SECS = 120;
/** Minimum interval between refresh attempts (ms) */
const MIN_REFRESH_INTERVAL_MS = 30_000;

function getSessionExpiry(): number | null {
  const raw = document.cookie
    .split('; ')
    .find(c => c.startsWith('session_expires='))
    ?.split('=')[1];
  if (!raw) return null;
  const val = parseInt(raw, 10);
  return Number.isFinite(val) ? val : null;
}

/**
 * Proactively refreshes the access token before it expires.
 * Reads the `session_expires` cookie (set by server on every auth cookie),
 * schedules a POST /api/auth/refresh call ~2 minutes before expiry,
 * and repeats after each successful rotation.
 *
 * On failure: clears auth state → user sees login screen.
 */
export function useTokenRefresh() {
  const user = useStore(s => s.user);
  const logout = useStore(s => s.logout);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!user) {
      // Not logged in — clear any pending timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current);

      const expiresAt = getSessionExpiry();
      if (!expiresAt) return;

      const nowSecs = Math.floor(Date.now() / 1000);
      const secsUntilExpiry = expiresAt - nowSecs;
      const secsUntilRefresh = Math.max(secsUntilExpiry - REFRESH_BUFFER_SECS, 5);
      const delayMs = secsUntilRefresh * 1000;

      timerRef.current = setTimeout(doRefresh, delayMs);
    }

    async function doRefresh() {
      // Mutex — prevent parallel refresh requests (e.g. rapid alt-tab)
      if (isRefreshingRef.current) return;

      // Debounce — don't refresh more than once per MIN_REFRESH_INTERVAL_MS
      const now = Date.now();
      if (now - lastRefreshRef.current < MIN_REFRESH_INTERVAL_MS) {
        scheduleRefresh();
        return;
      }
      lastRefreshRef.current = now;
      isRefreshingRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
        });

        if (res.ok) {
          // Server set new cookies — schedule next refresh
          scheduleRefresh();
        } else {
          // Refresh failed (token revoked, expired, etc.) — log out
          logout();
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Component unmounted — do not retry or update state
          return;
        }
        // Network error — retry in 30s rather than immediately logging out
        timerRef.current = setTimeout(doRefresh, 30_000);
      } finally {
        isRefreshingRef.current = false;
        abortRef.current = null;
      }
    }

    scheduleRefresh();

    // Also re-schedule when tab becomes visible (user returns from sleep/background)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        const expiresAt = getSessionExpiry();
        if (!expiresAt) return;
        const nowSecs = Math.floor(Date.now() / 1000);
        if (expiresAt - nowSecs < REFRESH_BUFFER_SECS) {
          // Already near/past expiry — refresh immediately
          doRefresh();
        } else {
          scheduleRefresh();
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user, logout]);
}
