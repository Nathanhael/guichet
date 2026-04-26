import useStore from '../store/useStore';
import { tStandalone } from '../i18n';

const BASE_TITLE = 'Guichet';
const FAVICON_HREF = '/favicon.ico';

export function requestNotificationPermission(): void {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

function isAgentRole(): boolean {
    const state = useStore.getState();
    const active = (state.memberships || []).find((m) => m.id === state.activeMembershipId);
    return active?.role === 'agent';
}

/**
 * Update browser tab title with unread count badge.
 *
 * Agents (AgentView) get a richer message: "● New message from Sarah —
 * Guichet" or "● 3 new messages from Sarah — Guichet" when all unread share
 * one sender, falling back to "● 3 new messages from support — Guichet"
 * when senders are mixed. Staff (support/admin/platform) get the compact
 * "(N) Guichet" badge — they juggle many tickets at once and a sender name
 * in the tab title would be misleading.
 */
export function updateTitleBadge(): void {
    const state = useStore.getState();
    const total = Object.values(state.unreadTickets).reduce((sum, n) => sum + (n || 0), 0);

    if (total <= 0) {
        document.title = BASE_TITLE;
        setFaviconDot(false);
        return;
    }

    if (!isAgentRole()) {
        document.title = `(${total}) ${BASE_TITLE}`;
        setFaviconDot(true);
        return;
    }

    const senders = new Set<string>();
    for (const tid of Object.keys(state.unreadTickets)) {
        const name = state.unreadSenders[tid];
        if (name) senders.add(name);
    }
    const uniqueSender = senders.size === 1 ? senders.values().next().value : null;

    let label: string;
    if (total === 1 && uniqueSender) {
        label = tStandalone('tab_new_message_from').replace('{name}', uniqueSender);
    } else if (uniqueSender) {
        label = tStandalone('tab_new_messages_from_one')
            .replace('{count}', String(total))
            .replace('{name}', uniqueSender);
    } else {
        label = tStandalone('tab_new_messages_from_support').replace('{count}', String(total));
    }

    document.title = `● ${label} — ${BASE_TITLE}`;
    setFaviconDot(true);
}

/**
 * Overlay a red dot on the favicon when there are unread messages, restore
 * the bare favicon when there aren't. Drawn on a <canvas>, swapped via a
 * dynamically-managed <link rel="icon"> so we never mutate the static one.
 */
let faviconLinkEl: HTMLLinkElement | null = null;
let faviconBaseImage: HTMLImageElement | null = null;
let faviconDotShown = false;

function setFaviconDot(show: boolean): void {
    if (typeof document === 'undefined') return;
    if (show === faviconDotShown && faviconLinkEl) return;
    faviconDotShown = show;

    if (!faviconLinkEl) {
        faviconLinkEl = document.querySelector<HTMLLinkElement>('link#favicon-dynamic');
        if (!faviconLinkEl) {
            faviconLinkEl = document.createElement('link');
            faviconLinkEl.id = 'favicon-dynamic';
            faviconLinkEl.rel = 'icon';
            document.head.appendChild(faviconLinkEl);
        }
    }

    if (!show) {
        faviconLinkEl.href = FAVICON_HREF;
        return;
    }

    const draw = (img: HTMLImageElement) => {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const r = 7;
        ctx.beginPath();
        ctx.arc(size - r - 1, r + 1, r, 0, Math.PI * 2);
        ctx.fillStyle = '#e5484d';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        if (faviconLinkEl) faviconLinkEl.href = canvas.toDataURL('image/png');
    };

    if (faviconBaseImage?.complete && faviconBaseImage.naturalWidth > 0) {
        draw(faviconBaseImage);
        return;
    }
    const img = new Image();
    img.onload = () => { faviconBaseImage = img; draw(img); };
    img.onerror = () => { if (faviconLinkEl) faviconLinkEl.href = FAVICON_HREF; };
    img.src = FAVICON_HREF;
}

/**
 * On window focus, dismiss the unread state for the ticket the user is
 * currently looking at (if any) and refresh the badge. Other tickets keep
 * their unread badges — focus alone doesn't mean "read everything", which
 * would otherwise wipe the per-ticket badges in QueueSidebar / ChatTabBar /
 * AdminTickets that staff rely on while juggling many chats.
 */
export function initTitleBadgeListener(): () => void {
    const handler = () => {
        const state = useStore.getState();
        if (state.activeTicketId) {
            state.clearUnread(state.activeTicketId);
        }
        updateTitleBadge();
    };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
}

// Synthesize a clean, professional 'chime' using Web Audio API
export function playChime(): void {
    try {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx: AudioContext = new AudioContextClass();

        // Osc 1: Base tone
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, ctx.currentTime); // A5
        gain1.gain.setValueAtTime(0, ctx.currentTime);
        gain1.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

        // Osc 2: Harmonic
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1320, ctx.currentTime); // E6
        gain2.gain.setValueAtTime(0, ctx.currentTime);
        gain2.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.02);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(ctx.currentTime + 0.6);
        osc2.stop(ctx.currentTime + 0.6);
    } catch (e) {
        console.warn('Audio synthesis failed', e);
    }
}

export function notify(title: string, options: NotificationOptions = {}): void {
    // Play chime regardless of focus to ensure awareness
    playChime();

    if (!document.hasFocus()) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                icon: '/favicon.ico',
                ...options
            });
        }
    }
}
