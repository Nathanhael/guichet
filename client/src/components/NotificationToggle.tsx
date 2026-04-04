import { useState, useEffect } from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Shared notification bell toggle used in both AgentView and SupportView navbars.
 * Renders an SVG bell (filled when on, outline when muted).
 * For agents: handles Web Push subscription instead of in-app notification toggle.
 */
export default function NotificationToggle() {
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useStore((s) => s.setNotificationsEnabled);
  const user = useStore((s) => s.user);
  const t = useT();
  const isAgent = user?.role === 'agent';
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  // Check existing push subscription on mount (agents only)
  useEffect(() => {
    if (!isAgent || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setPushSubscribed(!!sub);
      });
    });
  }, [isAgent]);

  async function togglePush() {
    if (pushLoading || !('serviceWorker' in navigator)) return;
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushSubscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch('/api/v1/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setPushSubscribed(false);
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { setPushLoading(false); return; }
        const keyRes = await fetch('/api/v1/push/vapid-key', { credentials: 'include' });
        if (!keyRes.ok) { setPushLoading(false); return; }
        const { vapidPublicKey } = await keyRes.json() as { vapidPublicKey: string };
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        });
        const p256dh = sub.getKey('p256dh');
        const auth = sub.getKey('auth');
        if (!p256dh || !auth) { setPushLoading(false); return; }
        await fetch('/api/v1/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            subscription: {
              endpoint: sub.endpoint,
              keys: {
                p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
                auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
              },
            },
          }),
        });
        setPushSubscribed(true);
      }
    } catch (err) {
      console.error('[push] Toggle error:', err);
    } finally {
      setPushLoading(false);
    }
  }

  const isBellActive = isAgent ? pushSubscribed : notificationsEnabled;

  function handleClick() {
    if (isAgent) {
      togglePush();
    } else {
      setNotificationsEnabled(!notificationsEnabled);
    }
  }

  function getTitle() {
    if (isAgent) {
      return pushSubscribed ? t('push_disable') : t('push_enable');
    }
    return notificationsEnabled ? t('notifications_on') : t('enable_notifications');
  }

  function getAriaLabel() {
    if (isAgent) {
      return pushSubscribed ? t('push_disable') : t('push_enable');
    }
    return notificationsEnabled ? t('mute_notifications') : t('enable_notifications');
  }

  return (
    <button
      onClick={handleClick}
      title={getTitle()}
      aria-label={getAriaLabel()}
      disabled={isAgent && pushLoading}
      className={`p-2 flex items-center justify-center ${
        isBellActive
          ? 'text-accent-blue bg-bg-elevated'
          : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {isBellActive ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      )}
    </button>
  );
}
