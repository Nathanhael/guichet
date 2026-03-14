import crypto from 'crypto';
import { get, run } from '../db.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { TranslationResult, ProcessedMessageResult } from '../types/index.js';

interface OllamaResponse {
  response: string;
}

const OLLAMA_HOST = config.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = config.OLLAMA_MODEL || 'gemmatranslate4b';

// ─── Cache setup ─────────────────────────────────────────────────────────────

function cacheKey(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

// ─── Ollama wrapper ───────────────────────────────────────────────────────────

/**
 * Calls the local Ollama instance for generation.
 * @param {string} prompt - The full prompt text.
 * @param {string} type - Descriptive type for logging (e.g. 'translate', 'improve').
 * @param {string} [modelOverride] - Optional model name to use instead of global default.
 * @returns {Promise<string>} The generated response text.
 */
async function callOllama(prompt: string, type: string, modelOverride?: string): Promise<string> {
  const start = Date.now();
  const modelToUse = modelOverride || MODEL;
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelToUse, prompt, stream: false }),
      signal: AbortSignal.timeout(10000), // 10s hard limit
    });

    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

    const data = await response.json() as OllamaResponse;
    const result = data.response?.trim();
    const duration = Date.now() - start;
    
    logger.info({ type, duration, model: modelToUse }, 'Ollama performance');
    
    if (!result) throw new Error('Ollama returned empty response');
    return result;
  } catch (err: unknown) {
    logger.error({ type, err: err instanceof Error ? err.message : String(err), model: modelToUse }, 'Ollama call failed');
    throw err;
  }
}

async function callOllamaWithRetry(prompt: string, type: string, modelOverride?: string, maxRetries = 1): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callOllama(prompt, type, modelOverride);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      logger.warn({ type, attempt, err: err instanceof Error ? err.message : String(err), model: modelOverride || MODEL }, 'Ollama attempt failed, retrying...');
    }
  }
  throw new Error('Ollama unreachable after retries');
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

async function getAIPrefix(partnerId: string): Promise<any> {
  const partner = await get('SELECT industry, ai_rules, agent_prompt_strategy, support_prompt_strategy, enable_actionable_ai, ai_enabled FROM partners WHERE id = $1', [partnerId]) as any;
  if (!partner) return { ai_rules: 'You are a professional support assistant.', ai_enabled: true };
  return partner;
}

async function buildAgentImprovementPrompt(text: string, lang: string, partner: any): Promise<string> {
  const langNames: Record<string, string> = { nl: 'Dutch', fr: 'French', en: 'English' };
  const langName = langNames[lang] || lang;
  const prefix = partner.ai_rules || `You are a professional ${partner.industry} support assistant.`;
  const strategy = partner.agent_prompt_strategy || 'Fix any spelling or grammar mistakes. Make the problem description clear and specific.';

  return `${prefix}

The agent sent this message in ${langName}. It may contain spelling errors, incomplete sentences, or vague descriptions.

Your strategy:
${strategy}

Your task:
- Keep technical terms and industry-specific terminology unchanged
- Keep it concise — do not add information that was not in the original
- If the message is already clear and correct, return it unchanged
- Return ONLY the improved message, no explanation, no preamble, no quotes

<agent_message>${text}</agent_message>`;
}

async function buildSupportImprovementPrompt(text: string, lang: string, partner: any): Promise<string> {
  const langNames: Record<string, string> = { nl: 'Dutch', fr: 'French', en: 'English' };
  const langName = langNames[lang] || lang;
  const prefix = partner.ai_rules || `You are a professional ${partner.industry} support assistant.`;
  const strategy = partner.support_prompt_strategy || 'If the message contains a procedure, rewrite it as clear numbered steps.';

  let taskList = `
- Keep technical product names unchanged
- Keep the same language (${langName})
- If the message is a short answer or question (not a procedure), return it as-is with minor cleanup only
- Do not add information that was not in the original`;

  if (partner.enable_actionable_ai) {
    taskList += `
- ENFORCE STRUCTURE: If providing a solution, always include a [CUSTOMER_SCRIPT] section with text the agent can tell the customer.
- Use [STEPS] for internal procedures.
- Use [SUMMARY] for a one-sentence overview.`;
  }

  return `${prefix}

The support specialist sent this message in ${langName}. It may be a long explanation, use technical jargon, or be structured as a paragraph.

Your strategy:
${strategy}

Your task:
${taskList}
- Return ONLY the improved message, no explanation, no preamble, no quotes

<support_message>${text}</support_message>`;
}

async function buildTranslationPrompt(text: string, fromLang: string, toLang: string, partner: any): Promise<string> {
  const langNames: Record<string, string> = { nl: 'Dutch', fr: 'French', en: 'English' };
  const from = langNames[fromLang] || fromLang;
  const to   = langNames[toLang]   || toLang;
  const prefix = partner.ai_rules || `You are a professional ${partner.industry} translator.`;

  return `${prefix}
You are a professional translator.
Translate the following ${from} text to ${to}.
Keep technical and industry terms unchanged.
If the text contains numbered steps or special tags like [CUSTOMER_SCRIPT], preserve them exactly.
Return ONLY the translated text — no explanation, no quotes, no preamble.

<text_to_translate>${text}</text_to_translate>`;
}

// ─── Improve ──────────────────────────────────────────────────────────────────

async function improve(text: string, lang: string, senderRole: 'agent'|'support', partner: any, partnerId: string): Promise<TranslationResult> {
  const key = cacheKey('improve', senderRole, lang, text, partnerId);

  const cached = await get('SELECT value FROM translations_cache WHERE key = $1', [key]) as { value: string } | undefined;
  if (cached) return { text: cached.value, fromCache: true };

  const prompt = senderRole === 'agent'
    ? await buildAgentImprovementPrompt(text, lang, partner)
    : await buildSupportImprovementPrompt(text, lang, partner);

  const improved = await callOllamaWithRetry(prompt, 'improve', partner.ollama_model);
  await run(
    'INSERT INTO translations_cache (key, value, from_lang, to_lang, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, created_at = EXCLUDED.created_at',
    [key, improved, lang, lang, new Date().toISOString()]
  );
  return { text: improved, fromCache: false };
}

// ─── Translate ────────────────────────────────────────────────────────────────

export async function translate(text: string, fromLang: string, toLang: string, partner: any, partnerId: string): Promise<TranslationResult> {
  if (fromLang === toLang) return { text, fromCache: false };

  const key = cacheKey('translate', fromLang, toLang, text, partnerId);

  const cached = await get('SELECT value FROM translations_cache WHERE key = $1', [key]) as { value: string } | undefined;
  if (cached) return { text: cached.value, fromCache: true };

  const prompt = await buildTranslationPrompt(text, fromLang, toLang, partner);
  const translated = await callOllamaWithRetry(prompt, 'translate', partner.ollama_model);
  await run(
    'INSERT INTO translations_cache (key, value, from_lang, to_lang, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, created_at = EXCLUDED.created_at',
    [key, translated, fromLang, toLang, new Date().toISOString()]
  );
  return { text: translated, fromCache: false };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Orchestrates the full AI message pipeline: Improvement followed by Translation.
 */
export async function processMessage(text: string, senderRole: 'agent'|'support', partnerId: string, fromLang?: string, toLang?: string): Promise<ProcessedMessageResult> {
  const from = (fromLang || 'nl').toLowerCase().slice(0, 2);
  const to   = (toLang   || 'nl').toLowerCase().slice(0, 2);

  try {
    const partner = await getAIPrefix(partnerId);
    
    // Check if AI is enabled for this partner
    if (partner && partner.ai_enabled === false) {
      return {
        processedText:      text,
        improvedText:       text,
        translationSkipped: from === to,
        fallback:           false,
      };
    }

    // Step 1: Improve (Always do this)
    const { text: improved } = await improve(text, from, senderRole, partner, partnerId);

    // Step 2: Translate (only if languages differ)
    if (from === to) {
      return {
        processedText:      improved,
        improvedText:       improved,
        translationSkipped: true,
        fallback:           false,
      };
    }

    const { text: translated } = await translate(improved, from, to, partner, partnerId);

    return {
      processedText:      translated,
      improvedText:       improved,
      translationSkipped: false,
      fallback:           false,
    };

  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[processMessage] Ollama unavailable, falling back');
    return {
      processedText:      text,
      improvedText:       text,
      translationSkipped: from === to,
      fallback:           true,
    };
  }
}
