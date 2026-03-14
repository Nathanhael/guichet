import { createClient } from 'redis';
import config from '../config.js';
import { GuardResult } from '../types/index.js';
import { getRepetitionCount } from './repetitionStore.js';

interface OllamaResponse {
  response: string;
}

const OLLAMA_HOST = config.OLLAMA_HOST || 'http://localhost:11434';
const MODEL       = config.OLLAMA_MODEL || 'gemmatranslate4b';

// ─── Guard result helpers ─────────────────────────────────────────────────────

function block(code: string): GuardResult {
  return { ok: false, code, sanitized: null };
}
function modify(code: string, sanitized: string): GuardResult {
  return { ok: true, code, sanitized };
}
function pass(): GuardResult {
  return { ok: true, code: 'PASS', sanitized: null };
}

// ─── 1. Minimum message length ───────────────────────────────────────────────

/**
 * Validates message length.
 * @param {string} text - Raw input.
 * @returns {GuardResult}
 */
export function guardLength(text: string): GuardResult {
  const trimmed = text?.trim() ?? '';
  if (trimmed.length < 3) {
    return block('guard_too_short');
  }
  if (trimmed.length > 2000) {
    return block('guard_too_long');
  }
  return pass();
}

// ─── 2. ALL CAPS ─────────────────────────────────────────────────────────────

export function guardCaps(text: string): GuardResult {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 10 && letters === letters.toUpperCase()) {
    const fixed = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    return modify('guard_all_caps_notice', fixed);
  }
  return pass();
}

// ─── 3. Repetition detection ─────────────────────────────────────────────────

export async function guardRepetition(
  redisClient: ReturnType<typeof createClient> | null,
  text: string,
  senderId: string
): Promise<GuardResult> {
  const normalized = text.trim().toLowerCase();
  const count = await getRepetitionCount(redisClient, senderId, normalized);

  if (count >= 3) {
    return block('guard_repetition');
  }

  return pass();
}

export function resetRepetition(_senderId: string): void {
  // Reset is handled by TTL and new text detection in Redis service
}

// ─── 4. Swearing / offensive language ────────────────────────────────────────

const SWEAR_WORDS = [
  'godverdomme', 'klootzak', 'kankerlij', 'tering', 'tyfus', 'eikel',
  'lul', 'kutwijf', 'hoer', 'mongool', 'debiel', 'idioot',
  'merde', 'putain', 'connard', 'salope', 'enculé', 'bordel',
  'fils de pute', 'ta gueule',
  'fuck', 'shit', 'asshole', 'bastard', 'bitch', 'cunt', 'piss off',
];

const swearRegex = new RegExp(
  `\\b(${SWEAR_WORDS.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})\\b`,
  'gi'
);

export function guardSwearing(text: string): GuardResult {
  swearRegex.lastIndex = 0;
  if (swearRegex.test(text)) {
    return block('guard_offensive');
  }
  return pass();
}

// ─── 5. Threats / aggressive language ────────────────────────────────────────

const THREAT_PATTERNS = [
  /\bik\s+(ga|zal|wil)\s+(je|jou|u|hem|haar)\s+(vermoorden|slaan|pakken|afmaken)\b/i,
  /\bpas\s+maar\s+op\b/i,
  /\bjij\s+bent\s+er\s+geweest\b/i,
  /\bje\s+(vais|veux)\s+te\s+(tuer|frapper|détruire)\b/i,
  /\btu\s+vas\s+le\s+regretter\b/i,
  /\bgare\s+à\s+toi\b/i,
  /\bi('ll| will| am going to)\s+(kill|hurt|destroy|ruin)\s+(you|him|her)\b/i,
  /\byou('ll| will)\s+regret\s+this\b/i,
  /\bwatch\s+your\s+back\b/i,
];

export function guardThreats(text: string): GuardResult {
  for (const pattern of THREAT_PATTERNS) {
    if (pattern.test(text)) {
      return block('guard_threat');
    }
  }
  return pass();
}

// ─── 6. Discriminatory language ──────────────────────────────────────────────

const DISCRIMINATION_PATTERNS = [
  /\b(alle?\s+)?(joden|moslims|negers|zigeuners|homo's)\s+(zijn|moeten|mogen)\b/i,
  /\b(raciste?|nazist?|fascist?)\b/i,
  /\bsieg\s+heil\b/i,
  /\b(tous\s+les\s+)?(arabes|noirs|juifs|homosexuels)\s+(sont|doivent|méritent)\b/i,
  /\b(all\s+)?(blacks|jews|muslims|gays)\s+(should|must|deserve)\b/i,
];

export function guardDiscrimination(text: string): GuardResult {
  for (const pattern of DISCRIMINATION_PATTERNS) {
    if (pattern.test(text)) {
      return block('guard_discrimination');
    }
  }
  return pass();
}

// ─── 7. Injection Patterns ───────────────────────────────────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior)\s+/i,
  /forget\s+(everything|all|your instructions)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /act\s+as\s+(if\s+you\s+are|a|an)\s+/i,
  /system\s*prompt\s*:/i,
  /\[INST\]|\[\/INST\]|<\|im_start\|>/i,
];

export function guardInjection(text: string): GuardResult {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return block('guard_injection');
    }
  }
  return pass();
}

// ─── 8. Telecom topic filter (Ollama) ────────────────────────────────────────

const TOPIC_PROMPT = (text: string) =>
`You are a content moderator for a professional telecom support chat system.

Determine if the following message is related to telecom support topics.

Telecom support topics include:
- Internet connectivity, modems, routers, Wi-Fi, fiber, DSL, ONT
- TV boxes, IPTV, digital television, set-top boxes
- Mobile phones, SIM cards, mobile data, calling, SMS
- Billing, invoices, contracts, subscriptions, pricing
- Technical troubleshooting, error codes, signal issues
- Account questions, service activation or cancellation
- Network outages and maintenance
- Short replies, greetings, or confirmations in the context of a support chat
  (e.g. "ok", "thanks", "understood", "yes that worked", "no problem")

NOT telecom support topics:
- Politics, religion, personal opinions
- General chat unrelated to telecom (sports, recipes, entertainment)
- Medical or legal advice

Respond with ONLY one word: ALLOWED or BLOCKED.

Message: ${text}`;

export async function guardTopic(text: string): Promise<GuardResult> {
  const trimmed = text.trim().toLowerCase();
  const QUICK_PASS = [
    'ok', 'oke', 'oké', 'ja', 'nee', 'oui', 'non', 'yes', 'no',
    'merci', 'dank', 'thanks', 'begrepen', 'compris', 'understood',
    'perfect', 'super', 'goed', 'bien', 'd\'accord', 'akkoord',
  ];
  if (trimmed.length < 20 || QUICK_PASS.includes(trimmed)) {
    return pass();
  }

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:  MODEL,
        prompt: TOPIC_PROMPT(text),
        stream: false,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

    const data = await response.json() as OllamaResponse;
    const verdict = data.response?.trim().toUpperCase();

    if (verdict === 'BLOCKED') {
      return block('guard_off_topic');
    }

    return pass();

  } catch (err: unknown) {
    console.warn('[guardTopic] Ollama unavailable, skipping topic check:', err instanceof Error ? err.message : String(err));
    return pass();
  }
}

// ─── Master guard runner ──────────────────────────────────────────────────────

/**
 * Master guard runner. Executes all guards in a tiered pipeline.
 * Tier 1: Local regex/length/injection checks (Fast, Cheap).
 * Tier 2: AI-based semantic topic check (Async, Expensive).
 * 
 * @param {ReturnType<typeof createClient> | null} redisClient - Redis client instance.
 * @param {string} text - The raw message text.
 * @param {string} senderId - ID of the sender for rate-limiting/repetition checks.
 * @returns {Promise<GuardResult & { text: string }>} Result of the guard check and the final (possibly sanitized) text.
 */
export async function runGuards(
  redisClient: ReturnType<typeof createClient> | null,
  text: string,
  senderId: string
): Promise<GuardResult & { text: string }> {
  let current = text;

  // 1. Length
  const lengthResult = guardLength(current);
  if (!lengthResult.ok) return { ...lengthResult, text: current };

  // 2. ALL CAPS
  const capsResult = guardCaps(current);
  if (capsResult.sanitized) current = capsResult.sanitized;

  // 3. Repetition
  const repResult = await guardRepetition(redisClient, current, senderId);
  if (!repResult.ok) return { ...repResult, text: current };

  // 4. Injection
  const injectionResult = guardInjection(current);
  if (!injectionResult.ok) return { ...injectionResult, text: current };

  // 5. Swearing
  const swearResult = guardSwearing(current);
  if (!swearResult.ok) return { ...swearResult, text: current };

  // 6. Threats
  const threatResult = guardThreats(current);
  if (!threatResult.ok) return { ...threatResult, text: current };

  // 7. Discrimination
  const discResult = guardDiscrimination(current);
  if (!discResult.ok) return { ...discResult, text: current };

  // 8. Topic filter (async, Ollama)
  const topicResult = await guardTopic(current);
  if (!topicResult.ok) return { ...topicResult, text: current };

  return { ok: true, code: 'PASS', text: current };
}
