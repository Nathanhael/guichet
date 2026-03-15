import config from '../../../config.js';
import logger from '../../../utils/logger.js';
import { LLMProvider, LLMOptions } from '../types.js';
import { aiPipelineDuration, aiPipelineErrorsTotal } from '../../../utils/metrics.js';

export class AzureProvider implements LLMProvider {
    private baseUrl = config.AI_BASE_URL || '';
    private apiKey = config.AI_API_KEY || '';
    private deployment = config.AZURE_OPENAI_DEPLOYMENT || 'o4-mini';
    private apiVersion = '2024-02-15-preview'; // Latest stable for o4-mini

    async generate(prompt: string, options?: LLMOptions): Promise<string> {
        const type = options?.type || 'generate';
        const end = aiPipelineDuration.startTimer({ type });

        try {
            const result = await this.callAzure(prompt, type);
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
        const end = aiPipelineDuration.startTimer({ type });

        try {
            const raw = await this.callAzure(prompt, type, true);
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

    private async callAzure(prompt: string, type: string, isJson = false): Promise<string> {
        if (!this.baseUrl || !this.apiKey) {
            throw new Error('Azure OpenAI configuration missing (AI_BASE_URL or AI_API_KEY)');
        }

        const url = `${this.baseUrl}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': this.apiKey
                },
                body: JSON.stringify({
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    ...(isJson ? { response_format: { type: 'json_object' } } : {})
                }),
                signal: AbortSignal.timeout(30000),
            });

            if (!response.ok) {
                const errBody = await response.text().catch(() => 'No error body');
                throw new Error(`Azure OpenAI HTTP ${response.status}: ${errBody}`);
            }

            const data = await response.json() as any;
            const result = data.choices?.[0]?.message?.content?.trim();

            if (!result) throw new Error('Azure OpenAI returned empty response');
            return result;
        } catch (err) {
            logger.error({ type, err: err instanceof Error ? err.message : String(err) }, 'Azure OpenAI call failed');
            throw err;
        }
    }
}
