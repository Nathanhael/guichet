import { useCallback, useEffect, useRef, useState } from 'react';

// Per spec decision 3: 60 s hard cap on the client. The backend enforces the
// same plus a 5 MB byte cap; we trust MediaRecorder's bitrate to stay under
// 5 MB at 60 s for any standard codec, and the server is the final guard.
const MAX_DURATION_MS = 60_000;
const TRANSCRIBE_URL = '/api/v1/ai/transcribe';

export type VoiceErrorKey =
  | 'mic_blocked'
  | 'mic_no_device'
  | 'mic_unsupported'
  | 'transcribe_failed'
  | 'transcribe_too_long'
  | 'transcribe_empty';

export interface UseVoiceTranscribeResult {
  isRecording: boolean;
  isTranscribing: boolean;
  elapsedSec: number;
  error: VoiceErrorKey | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => void;
  isSupported: boolean;
}

export interface UseVoiceTranscribeOptions {
  enabled: boolean;
  onTranscript: (text: string) => void;
}

interface MinimalRecorder {
  start: () => void;
  stop: () => void;
  state: string;
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

interface MinimalStream {
  getTracks: () => Array<{ stop: () => void }>;
}

/**
 * Voice dictation lifecycle for the support compose box. Owns getUserMedia
 * permission, MediaRecorder capture, the 60 s auto-stop, the elapsed-second
 * tick, and the upload to /api/v1/ai/transcribe. The error surface is i18n
 * KEYS — the caller resolves them through useT() so the chip stays
 * localized without leaking copy into the hook.
 */
export function useVoiceTranscribe(
  opts: UseVoiceTranscribeOptions,
): UseVoiceTranscribeResult {
  const { onTranscript } = opts;

  // MediaRecorder presence — once at hook init so the compose UI can branch
  // synchronously on the very first render.
  const isSupported =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder !== 'undefined';

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<VoiceErrorKey | null>(null);

  // Refs survive renders without re-running the lifecycle. We need them for
  // the tick interval, the 60 s auto-stop timer, the active recorder, the
  // active MediaStream (so we can stop tracks on cleanup), and the chunk
  // accumulator.
  const recorderRef = useRef<MinimalRecorder | null>(null);
  const streamRef = useRef<MinimalStream | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // The auto-stop path needs to flag the upload error AFTER stopRecording
  // resolves — the spec says we still upload the captured 60 s but surface
  // the too_long key so the user knows why we stopped.
  const autoStoppedRef = useRef(false);
  // onTranscript captured in a ref so the hook's recorder listeners don't
  // need to be torn down on every parent render.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const cleanupTimers = useCallback(() => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      try {
        s.getTracks().forEach((t) => t.stop());
      } catch {
        // Defensive — stream may already be teardown-complete.
      }
      streamRef.current = null;
    }
  }, []);

  const cancelRecording = useCallback(() => {
    cleanupTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      // Detach handlers so the pending dataavailable/stop don't trigger an
      // upload after we've thrown the buffer away.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        recorder.stop();
      } catch {
        // Recorder already stopped or in a weird state — fine.
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    cleanupStream();
    setIsRecording(false);
    setIsTranscribing(false);
    setElapsedSec(0);
  }, [cleanupTimers, cleanupStream]);

  const uploadAndDispatch = useCallback(async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'audio.webm');
      const res = await fetch(TRANSCRIBE_URL, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        setError('transcribe_failed');
        return;
      }
      const data = (await res.json()) as { transcript?: string };
      const transcript = (data.transcript ?? '').trim();
      if (transcript.length === 0) {
        setError('transcribe_empty');
        return;
      }
      // Auto-stop path: still dispatch the transcript, but flag it so the
      // user sees why recording ended (Decision 3 / 9).
      if (autoStoppedRef.current) {
        setError('transcribe_too_long');
      }
      onTranscriptRef.current(transcript);
    } catch {
      setError('transcribe_failed');
    } finally {
      autoStoppedRef.current = false;
      setIsTranscribing(false);
      cleanupStream();
    }
  }, [cleanupStream]);

  const startRecording = useCallback(async () => {
    // Re-entrancy guard. A double click while we're already in flight should
    // be a no-op; the button is also disabled during isTranscribing in the
    // UI so this is belt-and-braces.
    if (isRecording || isTranscribing) return;
    if (!isSupported) {
      setError('mic_unsupported');
      return;
    }
    setError(null);
    setElapsedSec(0);
    chunksRef.current = [];
    autoStoppedRef.current = false;

    let stream: MinimalStream;
    try {
      const mediaDevices =
        (globalThis.navigator as unknown as { mediaDevices?: MediaDevices }).mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        setError('mic_unsupported');
        return;
      }
      stream = (await mediaDevices.getUserMedia({ audio: true })) as unknown as MinimalStream;
    } catch (err) {
      // DOMException name discrimination per spec decision 9.
      const name = (err as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('mic_blocked');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('mic_no_device');
      } else {
        setError('transcribe_failed');
      }
      return;
    }

    streamRef.current = stream;
    const RecorderCtor = (globalThis as unknown as {
      MediaRecorder: new (s: MinimalStream) => MinimalRecorder;
    }).MediaRecorder;
    let recorder: MinimalRecorder;
    try {
      recorder = new RecorderCtor(stream);
    } catch {
      cleanupStream();
      setError('transcribe_failed');
      return;
    }

    recorder.ondataavailable = (ev) => {
      if (ev.data && (ev.data as Blob).size > 0) {
        chunksRef.current.push(ev.data as Blob);
      }
    };
    recorder.onstop = () => {
      cleanupTimers();
      setIsRecording(false);
      // Fire-and-forget the upload. The onstop handler can't be async, but
      // uploadAndDispatch flips isTranscribing internally so the UI can
      // observe the next state.
      void uploadAndDispatch();
    };
    recorder.onerror = () => {
      cleanupTimers();
      cleanupStream();
      setIsRecording(false);
      setIsTranscribing(false);
      setError('transcribe_failed');
    };

    recorderRef.current = recorder;
    setIsRecording(true);
    try {
      recorder.start();
    } catch {
      cleanupStream();
      setError('transcribe_failed');
      setIsRecording(false);
      return;
    }

    // 1-second tick. setInterval drives the elapsed counter visible on the
    // recording UI. We use a ref-stable callback so React strict-mode
    // double-render doesn't double-tick.
    tickIntervalRef.current = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);

    // Hard 60 s auto-stop (Decision 3). When this fires we still upload the
    // captured audio (Decision 9 says transcribe_too_long surfaces *after*
    // we've shipped the chunks).
    autoStopTimerRef.current = setTimeout(() => {
      autoStoppedRef.current = true;
      const r = recorderRef.current;
      if (r && r.state !== 'inactive') {
        try {
          r.stop();
        } catch {
          // Already stopped — recorder.onstop will still fire.
        }
      }
    }, MAX_DURATION_MS);
  }, [isRecording, isTranscribing, isSupported, cleanupTimers, cleanupStream, uploadAndDispatch]);

  const stopRecording = useCallback(async () => {
    cleanupTimers();
    const recorder = recorderRef.current;
    if (!recorder) {
      setIsRecording(false);
      return;
    }
    if (recorder.state === 'inactive') {
      // Already stopped (e.g., auto-stop fired between user clicks). Nothing
      // to do — the existing onstop handler will drive the upload.
      return;
    }
    try {
      recorder.stop();
    } catch {
      cleanupStream();
      setIsRecording(false);
      setError('transcribe_failed');
    }
  }, [cleanupTimers, cleanupStream]);

  // Defensive cleanup on unmount — a closed tab or unmounted ComposeArea
  // mid-recording must not leak the mic indicator (Decision 9).
  useEffect(() => {
    return () => {
      cleanupTimers();
      const r = recorderRef.current;
      if (r && r.state !== 'inactive') {
        r.ondataavailable = null;
        r.onstop = null;
        r.onerror = null;
        try {
          r.stop();
        } catch {
          // ignore
        }
      }
      cleanupStream();
    };
  }, [cleanupTimers, cleanupStream]);

  return {
    isRecording,
    isTranscribing,
    elapsedSec,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    isSupported,
  };
}
