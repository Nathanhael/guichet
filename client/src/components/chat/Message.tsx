// Public chat-message API. Bundle C slice 2 (#77): thin wrapper around
// MessageBubble; slice 3 (#78) inlines MessageBubble's body and deletes
// the legacy file.
//
// The lazy boundary for AttachmentGrid / QuoteBlock / LinkPreviewCard
// lives in MessageContent.tsx (which MessageBubble calls). Plain-text
// messages pay zero parse cost for the three fragments.

import MessageBubble from '../MessageBubble';
import type { Message as MessageType } from '../../types';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../server/trpc/router';

type AiConfig = inferRouterOutputs<AppRouter>['partner']['getAiConfig'];

export interface MessageProps {
  message: MessageType;
  ticketId?: string;
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
  onReply?: (message: MessageType) => void;
  suppressActions?: boolean;
  highlightQuery?: string;
  isSearchMatch?: boolean;
  isCurrentSearchMatch?: boolean;
  aiConfig?: AiConfig;
}

export default function Message({
  message,
  ticketId,
  isGroupStart = true,
  isGroupEnd = true,
  onReply,
  suppressActions,
  highlightQuery,
  isSearchMatch,
  isCurrentSearchMatch,
  aiConfig,
}: MessageProps) {
  // MessageBubble requires ticketId. Source from props, fall back to
  // message.ticketId for callers that haven't yet threaded it through.
  const resolvedTicketId = ticketId ?? message.ticketId;
  return (
    <MessageBubble
      message={message}
      ticketId={resolvedTicketId}
      isGroupStart={isGroupStart}
      isGroupEnd={isGroupEnd}
      onReply={onReply}
      suppressActions={suppressActions}
      highlightQuery={highlightQuery}
      isSearchMatch={isSearchMatch}
      isCurrentSearchMatch={isCurrentSearchMatch}
      aiConfig={aiConfig}
    />
  );
}
