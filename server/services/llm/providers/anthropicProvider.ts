import config from '../../../config.js';
import logger from '../../../utils/logger.js';
import { LLMProvider, LLMOptions } from '../types.js';
import { aiPipelineDuration, aiPipelineErrorsTotal } from '../../../utils/metrics.js';

export class AnthropicProvider implements LLMProvider {
    private apiKey = config.AI_API_KEY || '';
    private defaultModel = 'claude-3-5-sonnet-20240620';

    async generate(prompt: string, options?: LLMOptions): Promise<string> {
        const type = options?.type || 'generate';
        const model = options?.model || this.defaultModel;
        const end = aiPipelineDuration.startTimer({ type });

        try {
            const result = await this.callAnthropic(prompt, model, type);
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
            // Anthropic doesn't have a strict 'json' mode in the same way as OpenAI,
            // but we can enforce it via the prompt and parsing.
            const raw = await this.callAnthropic(prompt, model, type);
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

    private async callAnthropic(prompt: string, model: string, type: string): Promise<string> {
        if (!this.apiKey) {
            throw new Error('Anthropic API key missing (AI_API_KEY)');
        }

        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 1024,
                    messages: [
                        { role: 'user', content: prompt }
                    ]
                }),
                signal: AbortSignal.timeout(30000),
            });

            if (!response.ok) {
                const errBody = await response.text().catch(() => 'No error body');
                throw new Error(`Anthropic HTTP ${response.status}: ${errBody}`);
            }

            const data = await response.json() as any;
            const result = data.content?.[0]?.text?.trim();

            if (!result) throw new Error('Anthropic returned empty response');
            return result;
        } catch (err) {
            logger.error({ type, err: err instanceof Error ? err.message : String(err) }, 'Anthropic call failed');
            throw err;
        }
    }
}
