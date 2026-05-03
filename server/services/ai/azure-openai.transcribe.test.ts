import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { AzureOpenAiProvider } from './azure-openai.js';
import { initAiContext } from './context.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AzureOpenAiProvider.transcribe', () => {
  let provider: AzureOpenAiProvider;

  beforeAll(() => {
    initAiContext({
      db: {} as any,
      redis: null,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: {
        AI_ENABLED: true,
        AI_PROVIDER: 'azure-openai',
        AI_BASE_URL: 'https://test.openai.azure.com',
        AI_API_KEY: 'test-key',
        AI_TIMEOUT_MS: 30000,
        AZURE_OPENAI_DEPLOYMENT: 'o4-mini',
        NODE_ENV: 'test',
        REDIS_URL: '',
      } as any,
      decrypt: (s: string) => s,
      schema: {
        partners: {} as any,
        tickets: {} as any,
        messages: {} as any,
        aiPromptTemplates: {} as any,
        aiUsageLog: {} as any,
      },
    });
  });

  beforeEach(() => {
    provider = new AzureOpenAiProvider(
      'https://test.openai.azure.com',
      'test-key',
      'o4-mini',
    );
    mockFetch.mockReset();
  });

  it('POSTs to whisper deployment endpoint with default name when not configured', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello world', duration: 1.23 }),
    });

    const audio = Buffer.from('fakeaudio');
    await provider.transcribe!({ audio, mimeType: 'audio/webm' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/openai/deployments/whisper/audio/transcriptions');
    expect(String(url)).toContain('api-version=');
    expect(opts.method).toBe('POST');
  });

  it('uses custom whisperDeployment from constructor when provided', async () => {
    const customProvider = new AzureOpenAiProvider(
      'https://test.openai.azure.com',
      'test-key',
      'o4-mini',
      'whisper-prod',
    );
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok' }),
    });

    await customProvider.transcribe!({
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/openai/deployments/whisper-prod/audio/transcriptions');
  });

  it('sets api-key header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok' }),
    });

    await provider.transcribe!({
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['api-key']).toBe('test-key');
  });

  it('sends multipart body containing the audio buffer', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok' }),
    });

    const audio = Buffer.from('AUDIO_BYTES_MARKER');
    await provider.transcribe!({ audio, mimeType: 'audio/webm' });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.body).toBeInstanceOf(FormData);
    const fd = opts.body as FormData;
    const file = fd.get('file');
    expect(file).toBeInstanceOf(Blob);
    const fileBlob = file as Blob;
    const text = await fileBlob.text();
    expect(text).toContain('AUDIO_BYTES_MARKER');
    expect(fileBlob.type).toBe('audio/webm');
  });

  it('passes language hint when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'bonjour' }),
    });

    await provider.transcribe!({
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
      languageHint: 'fr',
    });

    const [, opts] = mockFetch.mock.calls[0];
    const fd = opts.body as FormData;
    expect(fd.get('language')).toBe('fr');
  });

  it('omits language field when no hint provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok' }),
    });

    await provider.transcribe!({
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
    });

    const [, opts] = mockFetch.mock.calls[0];
    const fd = opts.body as FormData;
    expect(fd.get('language')).toBeNull();
  });

  it('returns transcript and durationSeconds from response body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello there', duration: 4.56 }),
    });

    const result = await provider.transcribe!({
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
    });

    expect(result.transcript).toBe('hello there');
    expect(result.durationSeconds).toBe(4.56);
  });

  it('returns transcript with undefined duration when missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'no duration' }),
    });

    const result = await provider.transcribe!({
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
    });

    expect(result.transcript).toBe('no duration');
    expect(result.durationSeconds).toBeUndefined();
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });

    await expect(
      provider.transcribe!({
        audio: Buffer.from('x'),
        mimeType: 'audio/webm',
      }),
    ).rejects.toThrow(/Whisper transcription failed.*503/);
  });

  it('passes AbortSignal for timeout', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok' }),
    });

    await provider.transcribe!({
      audio: Buffer.from('x'),
      mimeType: 'audio/webm',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
