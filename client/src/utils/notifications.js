export function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

// Synthesize a clean, professional 'chime' using Web Audio API
export function playChime() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();

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

export function notify(title, options = {}) {
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
