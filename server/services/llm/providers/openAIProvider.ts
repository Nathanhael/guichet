import config from '../../../config.js';
import logger from '../../../utils/logger.js';
import { LLMProvider, LLMOptions } from '../types.js';
import { aiPipelineDuration, aiPipelineErrorsTotal } from '../../../utils/metrics.js';

export class OpenAIProvider implements LLMProvider {
    private baseUrl = config.AI_BASE_URL || 'http://localhost:1234/v1';
    private apiKey = config.AI_API_KEY || 'sk-dummy';

    async generate(prompt: string, options?: LLMOptions): Promise<string> {
        const type = options?.type || 'generate';
        const model = options?.model || 'gpt-4o-mini';
        const end = aiPipelineDuration.startTimer({ type });

        try {
            const result = await this.callOpenAI(prompt, model, type);
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
        const model = options?.model || 'gpt-4o-mini';
        const end = aiPipelineDuration.startTimer({ type });

        try {
            // Note: Some local providers might not support 'response_format: { type: "json_object" }'
            // We use a safe regex fallback in the response parsing.
            const raw = await this.callOpenAI(prompt, model, type, true);
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

    private async callOpenAI(prompt: string, model: string, type: string, isJson = false): Promise<string> {
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    ...(isJson ? { response_format: { type: 'json_object' } } : {})
                }),
                signal: AbortSignal.timeout(30000), // 30s limit for cloud/remote
            });

            if (!response.ok) {
                const errBody = await response.text().catch(() => 'No error body');
                throw new Error(`OpenAI-Compatible HTTP ${response.status}: ${errBody}`);
            }

            const data = await response.json() as any;
            const result = data.choices?.[0]?.message?.content?.trim();

            if (!result) throw new Error('OpenAI returned empty response');
            return result;
        } catch (err) {
            logger.error({ type, err: err instanceof Error ? err.message : String(err) }, 'OpenAI call failed');
            throw err;
        }
    }
}
