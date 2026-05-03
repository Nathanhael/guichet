// PII redaction for AI prompts. Stand-alone — no integration here.
// Patterns run in priority order; later patterns see already-redacted text.

export interface RedactionResult {
  redacted: string;
  tokens: Record<string, string>;
}

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Front anchor uses (?<!\w) instead of \b so the leading `+` in `+32 …` is not
// blocked by the word-boundary rule (\b cannot fire between space and `+`).
const PHONE_RE = /(?<!\w)(?:\+32|0)\s?\d{2,3}\s?\d{2}\s?\d{2}\s?\d{2}\b/g;
const NRN_RE = /\b\d{2}\.?\d{2}\.?\d{2}-?\d{3}\.?\d{2}\b/g;
const CC_RE = /(?<!\d)(?:\d[\s-]?){12,18}\d(?!\d)/g;
const TOKEN_RE = /\[(?:EMAIL|PHONE|NRN|CC)_\d+\]/g;

function isLuhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const code = digits.charCodeAt(i);
    if (code < 48 || code > 57) return false;
    let d = code - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function applyPattern(
  input: string,
  pattern: RegExp,
  prefix: string,
  tokens: Record<string, string>,
  validate?: (match: string) => boolean,
): string {
  let counter = 0;
  const seen = new Map<string, string>();
  return input.replace(pattern, (m) => {
    if (validate && !validate(m)) return m;
    const existing = seen.get(m);
    if (existing) return existing;
    counter += 1;
    const tok = `[${prefix}_${counter}]`;
    tokens[tok] = m;
    seen.set(m, tok);
    return tok;
  });
}

export function redactPii(text: string): RedactionResult {
  const tokens: Record<string, string> = {};
  let s = text;
  s = applyPattern(s, EMAIL_RE, 'EMAIL', tokens);
  s = applyPattern(s, PHONE_RE, 'PHONE', tokens);
  s = applyPattern(s, NRN_RE, 'NRN', tokens);
  s = applyPattern(s, CC_RE, 'CC', tokens, (m) => isLuhnValid(m.replace(/[\s-]/g, '')));
  return { redacted: s, tokens };
}

export function unredactPii(text: string, tokens: Record<string, string>): string {
  return text.replace(TOKEN_RE, (m) => tokens[m] ?? m);
}
