// ─── AI Provider Abstraction ────────────────────────────────────────────────

export interface ChatParams {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  chat(params: ChatParams): Promise<ChatResult>;
  chatStream(params: ChatParams): AsyncIterable<string>;
  isAvailable(): Promise<boolean>;
}

// ─── Prompt Template Types ──────────────────────────────────────────────────

export type AiAction =
  | 'classify'
  | 'suggest'
  | 'summarize'
  | 'improve'
  | 'translate'
  | 'match_canned';

export interface PromptTemplate {
  id: string;
  partnerId: string | null;
  action: AiAction;
  template: string;
  model: string | null;
}

// ─── Usage Log Types ────────────────────────────────────────────────────────

export interface AiUsageEntry {
  partnerId: string;
  userId: string;
  action: AiAction;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

// ─── Partner AI Config ──────────────────────────────────────────────────────

export type ImprovementMode = 'off' | 'optional' | 'forced';

export interface PartnerAiConfig {
  /** 'off' = disabled, 'optional' = sparkle button, 'forced' = auto-improve on send */
  messageImprovement?: ImprovementMode;
  chatSummarization?: boolean;
  /** When true, messages are auto-translated based on senderLang vs viewerLang */
  translation?: boolean;
  autoSummarizeOnClose?: boolean;
  rateLimits?: {
    perMinute?: number;
    perDay?: number;
  };
}
