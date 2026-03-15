import config from '../../config.js';
import { LLMProvider } from './types.js';
import { OllamaProvider } from './providers/ollamaProvider.js';
import { OpenAIProvider } from './providers/openAIProvider.js';
import { AzureProvider } from './providers/azureProvider.js';
import { GeminiProvider } from './providers/geminiProvider.js';
import { AnthropicProvider } from './providers/anthropicProvider.js';

let instance: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
    if (instance) return instance;

    switch (config.AI_PROVIDER) {
        case 'azure':
            instance = new AzureProvider();
            break;
        case 'openai-compatible':
            instance = new OpenAIProvider();
            break;
        case 'gemini':
            instance = new GeminiProvider();
            break;
        case 'anthropic':
            instance = new AnthropicProvider();
            break;
        case 'ollama':
        default:
            instance = new OllamaProvider();
            break;
    }

    return instance;
}
