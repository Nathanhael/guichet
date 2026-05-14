import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// MediaRecorder + getUserMedia + fetch mocks. Each test wires the mocks via
// helpers so individual tests can stub specific failure modes.
// ---------------------------------------------------------------------------

interface MockTrack {
  stop: ReturnType<typeof vi.fn>;
  kind: 'audio';
  readyState: 'live' | 'ended';
}

interface MockStream {
  getTracks: () => MockTrack[];
}

function makeMockStream(): { stream: MockStream; tracks: MockTrack[] } {
  const tracks: MockTrack[] = [
    { stop: vi.fn(function (this: MockTrack) { this.readyState = 'ended'; }), kind: 'audio', readyState: 'live' },
  ];
  return {
    tracks,
    stream: { getTracks: () => tracks },
  };
}

interface MockRecorderInstance {
  state: 'inactive' | 'recording' | 'paused';
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  __emitData: (blob: Blob) => void;
  __emitStop: () => void;
}

function makeRecorderClass() {
  const instances: MockRecorderInstance[] = [];
  class FakeMediaRecorder implements MockRecorderInstance {
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    ondataavailable: ((ev: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;

    constructor(public stream: MockStream) {
      this.start = vi.fn(() => { this.state = 'recording'; });
      this.stop = vi.fn(() => {
        this.state = 'inactive';
        // Mirror real MediaRecorder: stop fires `dataavailable` then `stop`.
        // Tests drive these explicitly via __emit* to avoid timing surprises.
      });
      instances.push(this);
    }

    __emitData(blob: Blob) {
      this.ondataavailable?.({ data: blob });
    }
    __emitStop() {
      this.onstop?.();
    }
  }
  return { MediaRecorder: FakeMediaRecorder, instances };
}

// We import the hook *inside* each test once mocks are wired. Otherwise the
// `typeof MediaRecorder !== 'undefined'` check at module load on first hook
// call captures whatever was set at that moment — fine for our tests because
// we set globals before each test.

import { useVoiceTranscribe } from './useVoiceTranscribe';

describe('useVoiceTranscribe', () => {
  let originalMediaRecorder: typeof globalThis.MediaRecorder | undefined;
  let originalGetUserMedia: MediaDevices['getUserMedia'] | undefined;
  let originalFetch: typeof globalThis.fetch | undefined;
  let recorderFactory: ReturnType<typeof makeRecorderClass>;

  beforeEach(() => {
    // Save originals.
    originalMediaRecorder = (globalThis as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    originalGetUserMedia = (globalThis.navigator as unknown as { mediaDevices?: { getUserMedia?: MediaDevices['getUserMedia'] } }).mediaDevices?.getUserMedia;
    originalFetch = globalThis.fetch;

    recorderFactory = makeRecorderClass();
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = recorderFactory.MediaRecorder;

    // Default mediaDevices stub — tests override per case.
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });

    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalMediaRecorder !== undefined) {
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = originalMediaRecorder;
    } else {
      delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    }
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia: originalGetUserMedia },
      configurable: true,
    });
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  });

  function mockGetUserMedia(stream: MockStream | (() => Promise<MockStream>) | { rejectWith: Error }) {
    const gum = vi.fn(async () => {
      if (typeof stream === 'function') return await (stream as () => Promise<MockStream>)();
      if ('rejectWith' in (stream as object)) {
        throw (stream as { rejectWith: Error }).rejectWith;
      }
      return stream as MockStream;
    });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia: gum },
      configurable: true,
    });
    return gum;
  }

  it('reports isSupported=false when MediaRecorder is not available', () => {
    delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );
    expect(result.current.isSupported).toBe(false);
  });

  it('reports isSupported=true when MediaRecorder is available', () => {
    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );
    expect(result.current.isSupported).toBe(true);
  });

  it('sets error=mic_blocked when getUserMedia rejects with NotAllowedError', async () => {
    const err = new DOMException('blocked', 'NotAllowedError');
    mockGetUserMedia({ rejectWith: err });

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('mic_blocked');
    expect(result.current.isRecording).toBe(false);
  });

  it('sets error=mic_no_device when getUserMedia rejects with NotFoundError', async () => {
    const err = new DOMException('no device', 'NotFoundError');
    mockGetUserMedia({ rejectWith: err });

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('mic_no_device');
    expect(result.current.isRecording).toBe(false);
  });

  it('sets error=transcribe_failed on a generic getUserMedia error', async () => {
    mockGetUserMedia({ rejectWith: new Error('boom') });

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('transcribe_failed');
  });

  it('advances elapsedSec every second while recording', async () => {
    vi.useFakeTimers();
    const { stream } = makeMockStream();
    mockGetUserMedia(stream);

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(result.current.elapsedSec).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.elapsedSec).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.elapsedSec).toBe(3);
  });

  it('auto-stops at 60s with error=transcribe_too_long and uploads the captured audio', async () => {
    vi.useFakeTimers();
    const { stream, tracks } = makeMockStream();
    mockGetUserMedia(stream);
    const onTranscript = vi.fn();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transcript: 'sixty seconds of speech' }),
    });

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    const recorder = recorderFactory.instances[0];

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    // Captured-audio chunk must be flushed before the upload runs. Real
    // MediaRecorder fires dataavailable + stop on .stop(); our mock makes
    // the test drive that explicitly so the upload sees a real Blob.
    await act(async () => {
      recorder.__emitData(new Blob(['audio-bytes'], { type: 'audio/webm' }));
      recorder.__emitStop();
    });

    vi.useRealTimers();

    await waitFor(() => {
      expect(result.current.error).toBe('transcribe_too_long');
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/ai/transcribe',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    // MediaStream tracks cleaned up after the upload.
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(onTranscript).toHaveBeenCalledWith('sixty seconds of speech');
  });

  it('posts FormData with the audio Blob to /api/v1/ai/transcribe on stopRecording', async () => {
    const { stream } = makeMockStream();
    mockGetUserMedia(stream);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transcript: 'hello world' }),
    });

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );

    await act(async () => {
      await result.current.startRecording();
    });
    const recorder = recorderFactory.instances[0];

    await act(async () => {
      // Drive a data chunk before the stop.
      recorder.__emitData(new Blob(['chunk-1'], { type: 'audio/webm' }));
    });

    await act(async () => {
      const stopPromise = result.current.stopRecording();
      // The hook should have triggered recorder.stop(); emit the stop event.
      recorder.__emitStop();
      await stopPromise;
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/v1/ai/transcribe');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const fd = (init as RequestInit).body as FormData;
    const audio = fd.get('audio');
    expect(audio).toBeInstanceOf(Blob);
  });

  it('calls onTranscript with the returned transcript on 200', async () => {
    const { stream } = makeMockStream();
    mockGetUserMedia(stream);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transcript: 'spoken words here' }),
    });
    const onTranscript = vi.fn();

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript }),
    );

    await act(async () => {
      await result.current.startRecording();
    });
    const recorder = recorderFactory.instances[0];

    await act(async () => {
      recorder.__emitData(new Blob(['x'], { type: 'audio/webm' }));
    });
    await act(async () => {
      const p = result.current.stopRecording();
      recorder.__emitStop();
      await p;
    });

    expect(onTranscript).toHaveBeenCalledWith('spoken words here');
    expect(result.current.error).toBeNull();
  });

  it('sets error=transcribe_empty and does NOT call onTranscript when transcript is empty', async () => {
    const { stream } = makeMockStream();
    mockGetUserMedia(stream);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transcript: '   ' }),
    });
    const onTranscript = vi.fn();

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript }),
    );
    await act(async () => {
      await result.current.startRecording();
    });
    const recorder = recorderFactory.instances[0];
    await act(async () => {
      recorder.__emitData(new Blob(['x'], { type: 'audio/webm' }));
    });
    await act(async () => {
      const p = result.current.stopRecording();
      recorder.__emitStop();
      await p;
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.error).toBe('transcribe_empty');
  });

  it('sets error=transcribe_failed on non-2xx server response', async () => {
    const { stream } = makeMockStream();
    mockGetUserMedia(stream);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server down' }),
    });
    const onTranscript = vi.fn();

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript }),
    );
    await act(async () => {
      await result.current.startRecording();
    });
    const recorder = recorderFactory.instances[0];
    await act(async () => {
      recorder.__emitData(new Blob(['x'], { type: 'audio/webm' }));
    });
    await act(async () => {
      const p = result.current.stopRecording();
      recorder.__emitStop();
      await p;
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.error).toBe('transcribe_failed');
  });

  it('cancelRecording stops tracks and does NOT upload', async () => {
    const { stream, tracks } = makeMockStream();
    mockGetUserMedia(stream);

    const { result } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );
    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      result.current.cancelRecording();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
  });

  it('cleans up MediaStream tracks on unmount even while recording', async () => {
    const { stream, tracks } = makeMockStream();
    mockGetUserMedia(stream);

    const { result, unmount } = renderHook(() =>
      useVoiceTranscribe({ enabled: true, onTranscript: vi.fn() }),
    );

    await act(async () => {
      await result.current.startRecording();
    });

    unmount();

    expect(tracks[0].stop).toHaveBeenCalled();
  });
});
