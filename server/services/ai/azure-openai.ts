import type { AiProvider, ChatParams, ChatResult } from './types.js';
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
  private apiVersion = '2025-04-01-preview';
  private availableCache: { result: boolean; ts: number } | null = null;
  private static AVAILABILITY_CACHE_TTL = 60_000; // 1 minute

  constructor(baseUrl: string, apiKey: string, deployment: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.deployment = deployment;
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
