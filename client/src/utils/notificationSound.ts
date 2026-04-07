let audioCtx: AudioContext | null = null;

/**
 * Play a short notification beep using Web Audio API.
 * No audio file needed — generates a clean 440Hz tone for 150ms.
 */
export function playNotificationSound(): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.frequency.value = 440; // A4 note
    oscillator.type = 'sine';
    gain.gain.value = 0.1; // quiet
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    oscillator.stop(audioCtx.currentTime + 0.15);
  } catch {
    // Audio not available — silent fail
  }
}
