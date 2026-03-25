import type { AiProvider, ChatParams, ChatResult } from './types.js';
import logger from '../../utils/logger.js';

/**
 * Azure OpenAI provider.
 * Uses Azure's deployment-based API with SSE streaming.
 */
export class AzureOpenAiProvider implements AiProvider {
  readonly name = 'azure-openai';
  private baseUrl: string;
  private apiKey: string;
  private deployment: string;
  private apiVersion = '2024-06-01';
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

  async chat(params: ChatParams): Promise<ChatResult> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens,
      }),
    });

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
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens,
        stream: true,
      }),
    });

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
    let result = false;
    try {
      // Simple HEAD-style check — Azure returns 405 for GET but that means the endpoint is reachable
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
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
