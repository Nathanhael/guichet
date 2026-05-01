// server/services/moderator/policy.ts
import { moderatorRepetitionFailopenTotal } from '../../utils/metrics.js';
import type {
  GuardCode,
  ModerationContext,
  ModerationResult,
  ModeratorDeps,
} from './index.js';

const SWEAR_WORDS = [
  'godverdomme', 'klootzak', 'kankerlij', 'tering', 'tyfus', 'eikel',
  'lul', 'kutwijf', 'hoer', 'mongool', 'debiel', 'idioot',
  'merde', 'putain', 'connard', 'salope', 'enculé', 'bordel',
  'fils de pute', 'ta gueule',
  'fuck', 'shit', 'asshole', 'bastard', 'bitch', 'cunt', 'piss off',
];
const swearRegex = new RegExp(
  `\\b(${SWEAR_WORDS.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})\\b`,
  'i',
);
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
const DISCRIMINATION_PATTERNS = [
  /\b(alle?\s+)?(joden|moslims|negers|zigeuners|homo's)\s+(zijn|moeten|mogen)\b/i,
  /\b(raciste?|nazist?|fascist?)\b/i,
  /\bsieg\s+heil\b/i,
  /\b(tous\s+les\s+)?(arabes|noirs|juifs|homosexuels)\s+(sont|doivent|méritent)\b/i,
  /\b(all\s+)?(blacks|jews|muslims|gays)\s+(should|must|deserve)\b/i,
];
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior)\s+/i,
  /forget\s+(everything|all|your instructions)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /act\s+as\s+(if\s+you\s+are|a|an)\s+/i,
  /system\s*prompt\s*:/i,
  /\[INST\]|\[\/INST\]|<\|im_start\|>/i,
];

const REPETITION_THRESHOLD = 3;

export async function runPolicy(
  original: string,
  ctx: ModerationContext,
  deps: ModeratorDeps,
): Promise<ModerationResult> {
  const triggered: GuardCode[] = [];
  let current = original;

  // 1. Length (block-only).
  const trimmed = current?.trim() ?? '';
  if (trimmed.length === 0) {
    return finalize(original, current, triggered, 'guard_too_short');
  }
  if (trimmed.length > 2000) {
    return finalize(original, current, triggered, 'guard_too_long');
  }

  // 2. ALL CAPS (modify-only — never blocks).
  const letters = current.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 10 && letters === letters.toUpperCase()) {
    current = current.charAt(0).toUpperCase() + current.slice(1).toLowerCase();
    triggered.push('guard_all_caps_notice');
  }

  // 3. Injection (block-only).
  if (INJECTION_PATTERNS.some((p) => p.test(current))) {
    return finalize(original, current, triggered, 'guard_injection');
  }
  // 4. Swearing (block-only).
  if (swearRegex.test(current)) {
    return finalize(original, current, triggered, 'guard_offensive');
  }
  // 5. Threats (block-only).
  if (THREAT_PATTERNS.some((p) => p.test(current))) {
    return finalize(original, current, triggered, 'guard_threat');
  }
  // 6. Discrimination (block-only).
  if (DISCRIMINATION_PATTERNS.some((p) => p.test(current))) {
    return finalize(original, current, triggered, 'guard_discrimination');
  }

  // 7. Repetition (block-only). Skipped on `message:edit` — re-editing
  //    identical text is normal. Runs on `message:send` + `ticket:create`.
  if (ctx.scope !== 'message:edit') {
    try {
      const { count } = await deps.repetition.observe({
        senderId: ctx.senderId,
        partnerId: ctx.partnerId,
        text: current,
      });
      if (count >= REPETITION_THRESHOLD) {
        return finalize(original, current, triggered, 'guard_repetition');
      }
    } catch (err) {
      // Fail-open: count the silence.
      moderatorRepetitionFailopenTotal.inc({ scope: ctx.scope });
      deps.logger?.warn(
        { err: err instanceof Error ? err.message : String(err), scope: ctx.scope },
        '[moderator] repetition port threw — failing open',
      );
    }
  }

  return {
    decision: 'pass',
    blockingCode: null,
    original,
    sanitized: current,
    triggered,
  };
}

function finalize(
  original: string,
  sanitized: string,
  triggered: GuardCode[],
  blockingCode: GuardCode,
): ModerationResult {
  return {
    decision: 'block',
    blockingCode,
    original,
    sanitized,
    triggered: [...triggered, blockingCode],
  };
}
