import config from '../../../config.js';
import logger from '../../../utils/logger.js';
import { LLMProvider, LLMOptions } from '../types.js';
import { aiPipelineDuration, aiPipelineErrorsTotal } from '../../../utils/metrics.js';

export class GeminiProvider implements LLMProvider {
    private apiKey = config.AI_API_KEY || '';
    private defaultModel = 'gemini-1.5-flash';

    async generate(prompt: string, options?: LLMOptions): Promise<string> {
        const type = options?.type || 'generate';
        const model = options?.model || this.defaultModel;
        const end = aiPipelineDuration.startTimer({ type });

        try {
            const result = await this.callGemini(prompt, model, type);
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
            const raw = await this.callGemini(prompt, model, type, true);
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

    private async callGemini(prompt: string, model: string, type: string, isJson = false): Promise<string> {
        if (!this.apiKey) {
            throw new Error('Gemini API key missing (AI_API_KEY)');
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        ...(isJson ? { responseMimeType: 'application/json' } : {})
                    }
                }),
                signal: AbortSignal.timeout(30000),
            });

            if (!response.ok) {
                const errBody = await response.text().catch(() => 'No error body');
                throw new Error(`Gemini HTTP ${response.status}: ${errBody}`);
            }

            const data = await response.json() as any;
            const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (!result) throw new Error('Gemini returned empty response');
            return result;
        } catch (err) {
            logger.error({ type, err: err instanceof Error ? err.message : String(err) }, 'Gemini call failed');
            throw err;
        }
    }
}
