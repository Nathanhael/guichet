/**
 * Language-code text labels (replaces the former flag-emoji labels).
 * Kept as a constant so the DemoUserPicker + any future caller share the
 * same source. The regional-indicator flag codepoints were removed because
 * Rolldown's hash-placeholder resolver panicked when they landed at
 * mid-chunk byte offsets; text also aligns with the brutalist spec.
 */
export const LANG_LABEL: Record<string, string> = {
  nl: 'NL',
  fr: 'FR',
  en: 'EN',
};

/** Fixed emoji set for message reactions (mirrors server/constants.ts) */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🎉', '✅'] as const;

/** Application brand name — single source of truth for UI chrome */
export const APP_NAME = 'GUICHET';
