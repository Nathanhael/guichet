export interface EmojiEntry {
  emoji: string;
  name: string;
  keywords: string[];
}

/** Support-relevant emoji with searchable names and keyword aliases. */
export const EMOJI_DATA: EmojiEntry[] = [
  // Faces
  { emoji: '😀', name: 'grin', keywords: ['happy', 'face', 'smile'] },
  { emoji: '😂', name: 'joy', keywords: ['laugh', 'cry', 'funny', 'lol'] },
  { emoji: '🙂', name: 'slight_smile', keywords: ['face', 'okay'] },
  { emoji: '😊', name: 'smile', keywords: ['happy', 'face', 'blush'] },
  { emoji: '😍', name: 'heart_eyes', keywords: ['love', 'face', 'adore'] },
  { emoji: '😎', name: 'sunglasses', keywords: ['cool', 'face'] },
  { emoji: '🤔', name: 'thinking', keywords: ['hmm', 'consider', 'face'] },
  { emoji: '😅', name: 'sweat_smile', keywords: ['nervous', 'relief'] },
  { emoji: '😢', name: 'cry', keywords: ['sad', 'tear', 'face'] },
  { emoji: '😤', name: 'frustrated', keywords: ['angry', 'huff', 'mad'] },

  // Gestures
  { emoji: '👋', name: 'wave', keywords: ['hello', 'hi', 'bye', 'hand'] },
  { emoji: '🙏', name: 'pray', keywords: ['please', 'thanks', 'hope', 'hands'] },
  { emoji: '👍', name: 'thumbsup', keywords: ['yes', 'ok', 'good', 'like', '+1'] },
  { emoji: '👎', name: 'thumbsdown', keywords: ['no', 'bad', 'dislike', '-1'] },
  { emoji: '👏', name: 'clap', keywords: ['bravo', 'applause', 'congrats'] },

  // Reactions
  { emoji: '❤️', name: 'heart', keywords: ['love', 'red'] },
  { emoji: '🔥', name: 'fire', keywords: ['hot', 'lit', 'awesome'] },
  { emoji: '⭐', name: 'star', keywords: ['favorite', 'best'] },
  { emoji: '✅', name: 'check', keywords: ['done', 'complete', 'yes', 'tick'] },
  { emoji: '🎉', name: 'party', keywords: ['celebrate', 'tada', 'congrats'] },

  // Symbols
  { emoji: '💡', name: 'bulb', keywords: ['idea', 'light', 'tip'] },
  { emoji: '⚠️', name: 'warning', keywords: ['alert', 'caution', 'danger'] },
  { emoji: '💬', name: 'speech', keywords: ['comment', 'chat', 'message'] },
  { emoji: '📎', name: 'paperclip', keywords: ['attach', 'clip', 'file'] },
  { emoji: '🚀', name: 'rocket', keywords: ['launch', 'fast', 'ship'] },
  { emoji: '🐛', name: 'bug', keywords: ['issue', 'error', 'debug'] },
  { emoji: '🔒', name: 'lock', keywords: ['secure', 'private', 'locked'] },
  { emoji: '⏳', name: 'hourglass', keywords: ['wait', 'time', 'pending'] },
  { emoji: '📝', name: 'memo', keywords: ['note', 'write', 'document'] },
  { emoji: '🔗', name: 'link', keywords: ['url', 'chain', 'connect'] },
];

/** Just the emoji characters — for the click grid picker. */
export const EMOJI_LIST = EMOJI_DATA.map((e) => e.emoji);

/** Search emoji by query string (matches name or keywords). */
export function searchEmoji(query: string, limit = 8): EmojiEntry[] {
  const q = query.toLowerCase();
  return EMOJI_DATA.filter(
    (e) => e.name.includes(q) || e.keywords.some((k) => k.includes(q)),
  ).slice(0, limit);
}
