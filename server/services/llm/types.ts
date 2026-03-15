export interface LLMOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    format?: 'json' | 'text';
    type?: string; // Descriptive type for logging/metrics (e.g. 'translate', 'summarize')
}

export interface LLMProvider {
    /**
     * Generates a text response from the LLM.
     */
    generate(prompt: string, options?: LLMOptions): Promise<string>;

    /**
     * Generates a structured JSON response from the LLM.
     */
    generateJSON<T>(prompt: string, options?: LLMOptions): Promise<T>;
}
