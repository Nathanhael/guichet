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
 * @returns {Promise<string>} The generated response text.
 */
async function callOllama(prompt: string, type: string): Promise<string> {
  const start = Date.now();
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false }),
      signal: AbortSignal.timeout(10000), // 10s hard limit
    });

    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

    const data = await response.json() as OllamaResponse;
    const result = data.response?.trim();
    const duration = Date.now() - start;
    
    logger.info({ type, duration, model: MODEL }, 'Ollama performance');
    
    if (!result) throw new Error('Ollama returned empty response');
    return result;
  } catch (err: unknown) {
    logger.error({ type, err: err instanceof Error ? err.message : String(err) }, 'Ollama call failed');
    throw err;
  }
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function buildAgentImprovementPrompt(text: string, lang: string): string {
  const langNames: Record<string, string> = { nl: 'Dutch', fr: 'French', en: 'English' };
  const langName = langNames[lang] || lang;

  return `You are a telecom support assistant helping agents communicate clearly with technical experts.

The agent sent this message in ${langName}. It may contain spelling errors, incomplete sentences, or vague descriptions.

Your task:
- Fix any spelling or grammar mistakes
- Make the problem description clear and specific
- Keep the same language (${langName})
- Keep technical terms unchanged (modem, router, DSC, FOT, CDBID, Dare Ref, ONT, IPTV, etc.)
- Keep it concise — do not add information that was not in the original
- If the message is already clear and correct, return it unchanged
- Return ONLY the improved message, no explanation, no preamble, no quotes

<agent_message>${text}</agent_message>`;
}

function buildExpertImprovementPrompt(text: string, lang: string): string {
  const langNames: Record<string, string> = { nl: 'Dutch', fr: 'French', en: 'English' };
  const langName = langNames[lang] || lang;

  return `You are a telecom support assistant helping experts communicate with non-technical agents.

The expert sent this message in ${langName}. It may be a long explanation, use technical jargon, or be structured as a paragraph.

Your task:
- If the message contains a procedure or multiple actions, rewrite it as clear numbered steps
- Replace technical jargon with plain language the agent can understand and relay to the customer
- Keep technical product names unchanged (modem, router, ONT, IPTV, etc.)
- Keep the same language (${langName})
- If the message is a short answer or question (not a procedure), return it as-is with minor cleanup only
- Do not add information that was not in the original
- Return ONLY the improved message, no explanation, no preamble, no quotes

<expert_message>${text}</expert_message>`;
}

function buildTranslationPrompt(text: string, fromLang: string, toLang: string): string {
  const langNames: Record<string, string> = { nl: 'Dutch', fr: 'French', en: 'English' };
  const from = langNames[fromLang] || fromLang;
  const to   = langNames[toLang]   || toLang;

  return `You are a professional telecom support translator.
Translate the following ${from} text to ${to}.
Keep technical terms unchanged (modem, router, DSC, FOT, CDBID, ONT, IPTV, Dare Ref).
If the text contains numbered steps, preserve the numbering exactly.
Return ONLY the translated text — no explanation, no quotes, no preamble.

<text_to_translate>${text}</text_to_translate>`;
}

// ─── Improve ──────────────────────────────────────────────────────────────────

async function improve(text: string, lang: string, senderRole: 'agent'|'expert'): Promise<TranslationResult> {
  const key = cacheKey('improve', senderRole, lang, text);

  const cached = await get('SELECT value FROM translations_cache WHERE key = $1', [key]) as { value: string } | undefined;
  if (cached) return { text: cached.value, fromCache: true };

  const prompt = senderRole === 'agent'
    ? buildAgentImprovementPrompt(text, lang)
    : buildExpertImprovementPrompt(text, lang);

  const improved = await callOllama(prompt, 'improve');
  await run(
    'INSERT INTO translations_cache (key, value, from_lang, to_lang, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, created_at = EXCLUDED.created_at',
    [key, improved, lang, lang, new Date().toISOString()]
  );
  return { text: improved, fromCache: false };
}

// ─── Translate ────────────────────────────────────────────────────────────────

export async function translate(text: string, fromLang: string, toLang: string): Promise<TranslationResult> {
  if (fromLang === toLang) return { text, fromCache: false };

  const key = cacheKey('translate', fromLang, toLang, text);

  const cached = await get('SELECT value FROM translations_cache WHERE key = $1', [key]) as { value: string } | undefined;
  if (cached) return { text: cached.value, fromCache: true };

  const prompt = buildTranslationPrompt(text, fromLang, toLang);
  const translated = await callOllama(prompt, 'translate');
  await run(
    'INSERT INTO translations_cache (key, value, from_lang, to_lang, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, created_at = EXCLUDED.created_at',
    [key, translated, fromLang, toLang, new Date().toISOString()]
  );
  return { text: translated, fromCache: false };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Orchestrates the full AI message pipeline: Improvement followed by Translation.
 * 
 * @param {string} text - The raw input text from the sender.
 * @param {'agent'|'expert'} senderRole - The role of the person sending the message.
 * @param {string} [fromLang] - The sender's language code (e.g. 'nl').
 * @param {string} [toLang] - The recipient's preferred language code.
 * @returns {Promise<ProcessedMessageResult>}
 */
export async function processMessage(text: string, senderRole: 'agent'|'expert', fromLang?: string, toLang?: string): Promise<ProcessedMessageResult> {
  const from = (fromLang || 'nl').toLowerCase().slice(0, 2);
  const to   = (toLang   || 'nl').toLowerCase().slice(0, 2);

  try {
    // Step 1: Improve
    const { text: improved } = await improve(text, from, senderRole);

    // Step 2: Translate (skip if same language)
    if (from === to) {
      return {
        processedText:      improved,
        improvedText:       improved,
        translationSkipped: true,
        fallback:           false,
      };
    }

    const { text: translated } = await translate(improved, from, to);

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
