// server/services/ai/context.ts
import type { RedisClientType } from 'redis';
import type { db as _db } from '../../db/postgres.js';
import type { partners, tickets, messages, aiPromptTemplates, aiUsageLog } from '../../db/schema.js';

/** Typed Drizzle schema subset used by AI modules */
export interface AiSchema {
  partners: typeof partners;
  tickets: typeof tickets;
  messages: typeof messages;
  aiPromptTemplates: typeof aiPromptTemplates;
  aiUsageLog: typeof aiUsageLog;
}

/**
 * Dependencies injected into the AI service layer at boot.
 * Eliminates all ../../ imports from AI modules.
 */
export interface AiContext {
  /** Drizzle ORM database instance */
  db: typeof _db;
  /** Shared Redis client (the app's pubClient) */
  redis: RedisClientType | null;
  /** Pino-compatible logger */
  logger: {
    debug: (obj: unknown, msg?: string) => void;
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
  /** Server config (AI_ENABLED, AI_TIMEOUT_MS, REDIS_URL, etc.) */
  config: {
    AI_ENABLED: boolean;
    AI_PROVIDER: string;
    AI_BASE_URL?: string;
    AI_API_KEY?: string;
    AI_TIMEOUT_MS: number;
    OLLAMA_HOST: string;
    OLLAMA_MODEL: string;
    OLLAMA_KEEPALIVE: string;
    AZURE_OPENAI_DEPLOYMENT?: string;
    NODE_ENV: string;
    REDIS_URL: string;
  };
  /** Decrypt an encrypted string (for API keys stored in DB) */
  decrypt: (ciphertext: string) => string;
  /** Drizzle schema tables used by AI modules */
  schema: AiSchema;
}

let ctx: AiContext | null = null;

/**
 * Initialize the AI context. Called once from app.ts after DB and Redis are ready.
 * Must be called before any AI operations.
 */
export function initAiContext(deps: AiContext): void {
  ctx = deps;
}

/**
 * Get the AI context. Throws if not initialized.
 */
export function getAiContext(): AiContext {
  if (!ctx) {
    throw new Error('AI context not initialized. Call initAiContext() first.');
  }
  return ctx;
}
