/** Flag emoji per language code */
export const LANG_FLAG: Record<string, string> = {
  nl: '\u{1F1E7}\u{1F1EA}',
  fr: '\u{1F1EB}\u{1F1F7}',
  en: '\u{1F1EC}\u{1F1E7}',
};

/** Flag emoji + language code (for UI labels) */
export const LANG_LABEL: Record<string, string> = {
  nl: '\u{1F1E7}\u{1F1EA} NL',
  fr: '\u{1F1EB}\u{1F1F7} FR',
  en: '\u{1F1EC}\u{1F1E7} EN',
};

/** Fixed emoji set for message reactions (mirrors server/constants.ts) */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🎉', '✅'] as const;
