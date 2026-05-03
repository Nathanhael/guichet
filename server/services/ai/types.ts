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

export interface TranscribeParams {
  audio: Buffer;
  mimeType: string;
  languageHint?: 'nl' | 'fr' | 'en';
}

export interface TranscribeResult {
  transcript: string;
  durationSeconds?: number;
}

export interface AiProvider {
  readonly name: string;
  chat(params: ChatParams): Promise<ChatResult>;
  chatStream(params: ChatParams): AsyncIterable<string>;
  isAvailable(): Promise<boolean>;
  /** Optional speech-to-text. Only providers with STT capability implement it. */
  transcribe?(params: TranscribeParams): Promise<TranscribeResult>;
}

// ─── Prompt Template Types ──────────────────────────────────────────────────

export type AiAction =
  | 'classify'
  | 'suggest'
  | 'summarize'
  | 'improve'
  | 'translate'
  | 'match_canned'
  | 'transcribe';

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
  /**
   * Full prompt/response content. Only populated when the partner's effective
   * audit verbosity is 'full' (slice 2.5). Persistence layer ignores these
   * fields until the ai_usage_log.metadata column lands in a follow-up slice.
   */
  prompt?: string;
  response?: string;
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
  /** When true, support staff can dictate replies via mic; backend exposes /transcribe */
  voiceTranscription?: boolean;
  /** When true, canned responses are auto-translated to NL/FR/EN; admin-editable. */
  cannedTranslation?: boolean;
  rateLimits?: {
    perMinute?: number;
    perDay?: number;
  };
}
