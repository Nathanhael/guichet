import { createClient } from 'redis';
import { GuardResult } from '../types/index.js';
import { getRepetitionCount } from './repetitionStore.js';

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
 *
 * Blocks empty / whitespace-only input and oversized input. Anything with
 * at least one visible character (after trimming) is allowed — including
 * single-grapheme messages like a single emoji ("😀"), a single letter
 * ("k"), or a single grapheme cluster ("👨‍👩‍👧"). The previous rule
 * required >= 3 UTF-16 code units, which silently rejected single-emoji
 * messages because most emojis are surrogate pairs (length 2). The server
 * still emits a rejection event so the client can clean up its optimistic
 * bubble — but legitimate short messages should not be rejected at all.
 *
 * @param {string} text - Raw input.
 * @returns {GuardResult}
 */
export function guardLength(text: string): GuardResult {
  const trimmed = text?.trim() ?? '';
  if (trimmed.length === 0) {
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
  'i'
);

export function guardSwearing(text: string): GuardResult {
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

// ─── Master guard runner ──────────────────────────────────────────────────────

/**
 * Runs all synchronous (non-Redis) guards: length, caps, injection, swearing,
 * threats, discrimination. These guards are deterministic and must always run
 * (fail closed). Returns the guard result and the possibly-sanitized text.
 */
export function runSyncGuards(text: string): GuardResult & { text: string } {
  let current = text;

  // 1. Length
  const lengthResult = guardLength(current);
  if (!lengthResult.ok) return { ...lengthResult, text: current };

  // 2. ALL CAPS (sanitizes but does not block)
  const capsResult = guardCaps(current);
  if (capsResult.sanitized) current = capsResult.sanitized;

  // 3. Injection
  const injectionResult = guardInjection(current);
  if (!injectionResult.ok) return { ...injectionResult, text: current };

  // 4. Swearing
  const swearResult = guardSwearing(current);
  if (!swearResult.ok) return { ...swearResult, text: current };

  // 5. Threats
  const threatResult = guardThreats(current);
  if (!threatResult.ok) return { ...threatResult, text: current };

  // 6. Discrimination
  const discResult = guardDiscrimination(current);
  if (!discResult.ok) return { ...discResult, text: current };

  return { ok: true, code: 'PASS', text: current };
}

/**
 * Master guard runner. Executes all guards in a tiered pipeline.
 * Runs local regex/length/injection/content checks in sequence,
 * then the Redis-dependent repetition guard.
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
  // Synchronous guards (fail closed)
  const syncResult = runSyncGuards(text);
  if (!syncResult.ok) return syncResult;

  // Redis-dependent guard (repetition)
  const repResult = await guardRepetition(redisClient, syncResult.text, senderId);
  if (!repResult.ok) return { ...repResult, text: syncResult.text };

  return { ok: true, code: 'PASS', text: syncResult.text };
}
