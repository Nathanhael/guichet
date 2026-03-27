import type { AiProvider, ChatParams, ChatResult } from './types.js';
import logger from '../../utils/logger.js';
import config from '../../config.js';

/**
 * Generic OpenAI-compatible provider.
 * Works with LM Studio, Groq, Together AI, vLLM, xAI Grok, etc.
 * Uses the standard /v1/chat/completions endpoint.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';
  private baseUrl: string;
  private apiKey: string | undefined;
  private defaultModel: string;

  constructor(baseUrl: string, defaultModel: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  private get endpoint(): string {
    // Support both /v1/chat/completions and /chat/completions
    const base = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;
    return `${base}/chat/completions`;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private wrapTimeoutError(err: unknown): never {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`AI request timed out after ${config.AI_TIMEOUT_MS}ms (provider: openai-compatible)`);
    }
    throw err;
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const model = params.model || this.defaultModel;

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model,
          messages: params.messages,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.maxTokens,
        }),
        signal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI-compatible request failed (${res.status}): ${text}`);
      }

      const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
        model: string;
      };

      return {
        content: data.choices[0]?.message.content ?? '',
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        model: data.model || model,
      };
    } catch (err) {
      this.wrapTimeoutError(err);
    }
  }

  async *chatStream(params: ChatParams): AsyncIterable<string> {
    const model = params.model || this.defaultModel;

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model,
          messages: params.messages,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.maxTokens,
          stream: true,
        }),
        signal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
      });
    } catch (err) {
      this.wrapTimeoutError(err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI-compatible stream failed (${res.status}): ${text}`);
    }

    if (!res.body) throw new Error('OpenAI-compatible returned no body');

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
            logger.debug({ payload }, 'Skipping unparseable SSE chunk');
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try to list models — most OpenAI-compatible APIs support this
      const base = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;
      const res = await fetch(`${base}/models`, {
        headers: this.headers,
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
