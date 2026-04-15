const BASE_TITLE = 'Guichet';

export function requestNotificationPermission(): void {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

/**
 * Update browser tab title with unread count badge.
 * Reads unreadTickets from the store.
 */
export function updateTitleBadge(): void {
    try {
        // Dynamically import to avoid circular dependency
        const { default: useStore } = require('../store/useStore');
        const count = Object.keys(useStore.getState().unreadTickets).length;
        document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
    } catch {
        // Ignore — store not yet initialized
    }
}

/**
 * Clear the title badge when window gets focus.
 * Should be called once on app init.
 */
export function initTitleBadgeListener(): void {
    window.addEventListener('focus', () => {
        document.title = BASE_TITLE;
    });
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
