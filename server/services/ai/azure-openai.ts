import type {
  AiProvider,
  ChatParams,
  ChatResult,
  TranscribeParams,
  TranscribeResult,
} from './types.js';
import { getAiContext } from './context.js';

/**
 * Azure OpenAI provider.
 * Uses Azure's deployment-based API with SSE streaming.
 */
export class AzureOpenAiProvider implements AiProvider {
  readonly name = 'azure-openai';
  private baseUrl: string;
  private apiKey: string;
  private deployment: string;
  private whisperDeployment: string;
  private apiVersion = '2025-04-01-preview';
  private availableCache: { result: boolean; ts: number } | null = null;
  private static AVAILABILITY_CACHE_TTL = 60_000; // 1 minute
  private static TRANSCRIBE_TIMEOUT_MS = 60_000;

  constructor(baseUrl: string, apiKey: string, deployment: string, whisperDeployment?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.deployment = deployment;
    this.whisperDeployment = whisperDeployment || 'whisper';
  }

  private get endpoint(): string {
    return `${this.baseUrl}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;
  }

  private wrapTimeoutError(err: unknown): never {
    const { config } = getAiContext();
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`AI request timed out after ${config.AI_TIMEOUT_MS}ms (provider: azure-openai)`);
    }
    throw err;
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const { config } = getAiContext();
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          messages: params.messages,
          temperature: params.temperature ?? 0.7,
          max_completion_tokens: params.maxTokens,
        }),
        signal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
      });
    } catch (err) {
      this.wrapTimeoutError(err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure OpenAI request failed (${res.status}): ${text}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message.content ?? '',
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      model: data.model || this.deployment,
    };
  }

  async *chatStream(params: ChatParams): AsyncIterable<string> {
    const { config, logger } = getAiContext();
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          messages: params.messages,
          temperature: params.temperature ?? 0.7,
          max_completion_tokens: params.maxTokens,
          stream: true,
        }),
        signal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
      });
    } catch (err) {
      this.wrapTimeoutError(err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure OpenAI stream failed (${res.status}): ${text}`);
    }

    if (!res.body) throw new Error('Azure OpenAI returned no body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') return;

          try {
            const chunk = JSON.parse(payload) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const content = chunk.choices[0]?.delta?.content;
            if (content) yield content;
          } catch {
            logger.debug({ payload }, 'Skipping unparseable Azure SSE chunk');
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async transcribe(params: TranscribeParams): Promise<TranscribeResult> {
    const url = `${this.baseUrl}/openai/deployments/${this.whisperDeployment}/audio/transcriptions?api-version=${this.apiVersion}`;
    const form = new FormData();
    const blob = new Blob([new Uint8Array(params.audio)], { type: params.mimeType });
    form.append('file', blob, 'audio');
    form.append('response_format', 'verbose_json');
    if (params.languageHint) {
      form.append('language', params.languageHint);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          // Content-Type is set automatically by FormData (multipart boundary).
          'api-key': this.apiKey,
        },
        body: form,
        signal: AbortSignal.timeout(AzureOpenAiProvider.TRANSCRIBE_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Whisper transcription timed out after ${AzureOpenAiProvider.TRANSCRIBE_TIMEOUT_MS}ms`, { cause: err });
      }
      throw err;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Whisper transcription failed: ${res.status}: ${text}`);
    }

    const data = await res.json() as { text: string; duration?: number };
    return {
      transcript: data.text ?? '',
      durationSeconds: typeof data.duration === 'number' ? data.duration : undefined,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (this.availableCache && Date.now() - this.availableCache.ts < AzureOpenAiProvider.AVAILABILITY_CACHE_TTL) {
      return this.availableCache.result;
    }
    let result: boolean;
    try {
      // Non-billable check: list deployments endpoint (no inference cost)
      const listUrl = `${this.baseUrl}/openai/deployments?api-version=${this.apiVersion}`;
      const res = await fetch(listUrl, {
        method: 'GET',
        headers: { 'api-key': this.apiKey },
        signal: AbortSignal.timeout(5000),
      });
      result = res.ok;
    } catch {
      result = false;
    }
    this.availableCache = { result, ts: Date.now() };
    return result;
  }
}
