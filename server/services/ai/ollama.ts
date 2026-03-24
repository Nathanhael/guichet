import type { AiProvider, ChatParams, ChatResult } from './types.js';
import logger from '../../utils/logger.js';

/**
 * Ollama provider — local LLM inference.
 * Uses the Ollama HTTP API with NDJSON streaming.
 * Free, no API key required.
 */
export class OllamaProvider implements AiProvider {
  readonly name = 'ollama';
  private host: string;
  private defaultModel: string;

  constructor(host: string, defaultModel: string) {
    // Strip trailing slash
    this.host = host.replace(/\/+$/, '');
    this.defaultModel = defaultModel;
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const model = params.model || this.defaultModel;
    const url = `${this.host}/api/chat`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: params.messages,
        stream: false,
        options: {
          temperature: params.temperature ?? 0.7,
          ...(params.maxTokens ? { num_predict: params.maxTokens } : {}),
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama request failed (${res.status}): ${text}`);
    }

    const data = await res.json() as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
      model: string;
    };

    return {
      content: data.message.content,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      model: data.model,
    };
  }

  async *chatStream(params: ChatParams): AsyncIterable<string> {
    const model = params.model || this.defaultModel;
    const url = `${this.host}/api/chat`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: params.messages,
        stream: true,
        options: {
          temperature: params.temperature ?? 0.7,
          ...(params.maxTokens ? { num_predict: params.maxTokens } : {}),
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama stream failed (${res.status}): ${text}`);
    }

    if (!res.body) throw new Error('Ollama returned no body');

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
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as { message?: { content: string }; done: boolean };
            if (chunk.message?.content) {
              yield chunk.message.content;
            }
          } catch {
            logger.debug({ line }, 'Skipping unparseable Ollama NDJSON line');
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
