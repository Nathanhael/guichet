import config from '../../../config.js';
import logger from '../../../utils/logger.js';
import { LLMProvider, LLMOptions } from '../types.js';
import { aiPipelineDuration, aiPipelineErrorsTotal } from '../../../utils/metrics.js';

interface OllamaResponse {
    response: string;
}

export class OllamaProvider implements LLMProvider {
    private host = config.OLLAMA_HOST || 'http://localhost:11434';
    private defaultModel = config.OLLAMA_MODEL || 'gemmatranslate4b';

    async generate(prompt: string, options?: LLMOptions): Promise<string> {
        const type = options?.type || 'generate';
        const model = options?.model || this.defaultModel;
        const end = aiPipelineDuration.startTimer({ type });

        try {
            const result = await this.callWithRetry(prompt, model, type);
            end();
            return result;
        } catch (err) {
            end();
            aiPipelineErrorsTotal.inc({ type });
            throw err;
        }
    }

    async generateJSON<T>(prompt: string, options?: LLMOptions): Promise<T> {
        const type = options?.type || 'generate_json';
        const model = options?.model || this.defaultModel;
        const end = aiPipelineDuration.startTimer({ type });

        try {
            const raw = await this.callWithRetry(prompt, model, type, true);
            end();

            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : raw;
            return JSON.parse(jsonStr) as T;
        } catch (err) {
            end();
            aiPipelineErrorsTotal.inc({ type });
            throw err;
        }
    }

    private async callWithRetry(prompt: string, model: string, type: string, isJson = false, maxRetries = 1): Promise<string> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(`${this.host}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model,
                        prompt,
                        stream: false,
                        ...(isJson ? { format: 'json' } : {})
                    }),
                    signal: AbortSignal.timeout(15000), // 15s limit
                });

                if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

                const data = await response.json() as OllamaResponse;
                const result = data.response?.trim();

                if (!result) throw new Error('Ollama returned empty response');
                return result;
            } catch (err) {
                if (attempt === maxRetries) throw err;
                const delay = 1000 * Math.pow(2, attempt);
                logger.warn({ type, attempt, delay, err: err instanceof Error ? err.message : String(err) }, 'Ollama attempt failed, retrying...');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('Ollama unreachable after retries');
    }
}
