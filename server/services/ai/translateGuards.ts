/**
 * Pre-flight check: should we ask the model to translate this text at all?
 *
 * Some inputs aren't translation-worthy — pure digits, whitespace, or
 * punctuation. Cheaper models break character on these edge cases and emit
 * meta-replies like "I'm sorry, that looks like placeholder text — could
 * you provide the real content?" — which then gets cached as the
 * "translation" and surfaces verbatim in the chat.
 *
 * Skipping the AI call entirely is both faster and safer: callers fall
 * back to the original text.
 *
 * Heuristic: requires at least one Unicode letter. Numbers, symbols,
 * emoji and whitespace alone are treated as non-translatable.
 */
export function shouldSkipTranslation(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  return !/\p{L}/u.test(text);
}
