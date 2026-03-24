/**
 * Format messages for AI consumption (summarization, suggestion, etc.)
 * Handles truncation to stay within token limits.
 */

interface MessageForAi {
  senderName: string | null;
  senderRole: string | null;
  text: string | null;
}

const MAX_MESSAGES = 50;
const MAX_CHARS_PER_MESSAGE = 500;

/**
 * Format a list of messages into a string for AI prompts.
 * Truncates long threads by keeping the first 5 and last (limit-5) messages.
 * Truncates individual messages to MAX_CHARS_PER_MESSAGE characters.
 */
export function formatMessagesForAi(
  msgs: MessageForAi[],
  maxMessages = MAX_MESSAGES,
): string {
  if (msgs.length === 0) return '(no messages)';

  let selected: (MessageForAi | string)[];

  if (msgs.length <= maxMessages) {
    selected = msgs;
  } else {
    const headCount = 5;
    const tailCount = maxMessages - headCount;
    const omitted = msgs.length - maxMessages;
    selected = [
      ...msgs.slice(0, headCount),
      `[... ${omitted} messages omitted for brevity ...]`,
      ...msgs.slice(-tailCount),
    ];
  }

  return selected
    .map((item) => {
      if (typeof item === 'string') return item;
      const name = item.senderName || 'Unknown';
      const role = item.senderRole || 'user';
      let text = item.text || '';
      if (text.length > MAX_CHARS_PER_MESSAGE) {
        text = text.slice(0, MAX_CHARS_PER_MESSAGE) + '...';
      }
      return `[${name} (${role})]: ${text}`;
    })
    .join('\n');
}
