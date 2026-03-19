import config from '../../config.js';
import { LLMProvider } from './types.js';
import { OllamaProvider } from './providers/ollamaProvider.js';
import { OpenAIProvider } from './providers/openAIProvider.js';
import { AzureProvider } from './providers/azureProvider.js';
import { GeminiProvider } from './providers/geminiProvider.js';
import { AnthropicProvider } from './providers/anthropicProvider.js';

const instances: Map<string, LLMProvider> = new Map();

export function getLLMProvider(providerName?: string): LLMProvider {
    const name = providerName || config.AI_PROVIDER || 'ollama';
    
    if (instances.has(name)) {
        return instances.get(name)!;
    }

    let instance: LLMProvider;

    switch (name) {
        case 'azure':
            instance = new AzureProvider();
            break;
        case 'openai-compatible':
        case 'openai':
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

    instances.set(name, instance);
    return instance;
}
