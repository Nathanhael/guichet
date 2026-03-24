import { useRef, useEffect } from 'react';
import { useT } from '../i18n';
import MessageBubble from './MessageBubble';
import { trpc } from '../utils/trpc';
import { Ticket, Message } from '../types';

const DEPT_COLOR: Record<string, string> = {
  DSC: 'bg-black text-white dark:bg-white dark:text-black',
  FOT: 'bg-white text-black dark:bg-black dark:text-white',
};

interface TicketPreviewProps {
  ticket: Ticket;
  messages?: Message[];
  onJoin: () => void;
  onClose: () => void;
  joinDisabled?: boolean;
}

export default function TicketPreview({ ticket, messages: propMessages, onJoin, onClose, joinDisabled }: TicketPreviewProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch messages for preview if none provided
  const messageQuery = trpc.message.list.useQuery(
    { ticketId: ticket.id },
    { enabled: !!ticket.id && (!propMessages || propMessages.length === 0) }
  );

  const messages = (propMessages && propMessages.length > 0) ? propMessages : (messageQuery.data as Message[] || []);

  // Scroll to bottom when messages load
  useEffect(() => {
    if (messages.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);
  return (
    <div className="h-full flex flex-col p-4">
      <div className="bg-white dark:bg-black border-4 border-black dark:border-white flex flex-col h-full overflow-hidden">
        {/* Preview header */}
        <div className="flex items-center justify-between px-6 py-4 border-b-2 border-black dark:border-white bg-white dark:bg-black">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
             <span className={`text-[10px] font-black px-2 py-0.5 border border-current uppercase tracking-widest shrink-0 ${DEPT_COLOR[ticket.dept] || DEPT_COLOR[ticket.dept.toUpperCase()] || 'bg-white text-black'}`}>
              {ticket.dept}
            </span>
            <span className="text-sm font-black uppercase tracking-tight text-black dark:text-white truncate">{ticket.agentName}</span>
            <span className="text-[10px] text-white dark:text-black bg-black dark:bg-white px-2 py-0.5 font-black uppercase tracking-widest shrink-0">
              {t('preview_mode')}
            </span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center border-2 border-black dark:border-white font-black hover:invert transition-all">×</button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-1 bg-white dark:bg-black">
          {messageQuery.isLoading ? (
            <div className="h-full flex flex-col items-center justify-center opacity-30">
              <svg className="animate-spin h-6 w-6 mb-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-[10px] font-black uppercase tracking-widest">{t('loading') || 'Loading...'}</p>
            </div>
          ) : !messages || messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20">
              <p className="text-sm font-black uppercase tracking-widest">{t('no_messages')}</p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const nextMsg = messages[idx + 1];
              const isSameSenderAsPrev = prevMsg && prevMsg.senderId === msg.senderId && !prevMsg.system && !msg.system;
              const isSameSenderAsNext = nextMsg && nextMsg.senderId === msg.senderId && !nextMsg.system && !msg.system;
              const msgTime = msg.timestamp || msg.createdAt || '';
              const prevTime = prevMsg?.timestamp || prevMsg?.createdAt || '';
              const nextTime = nextMsg?.timestamp || nextMsg?.createdAt || '';
              const timeDiffPrev = prevMsg ? (new Date(msgTime).getTime() - new Date(prevTime).getTime()) : 0;
              const timeDiffNext = nextMsg ? (new Date(nextTime).getTime() - new Date(msgTime).getTime()) : 0;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  ticketId={ticket.id}
                  isGroupStart={!isSameSenderAsPrev || timeDiffPrev > 120000}
                  isGroupEnd={!isSameSenderAsNext || timeDiffNext > 120000}
                />
              );
            })
          )}
        </div>

        {/* Join bar */}
        <div className="px-6 py-4 border-t-2 border-black dark:border-white bg-white dark:bg-black flex items-center justify-between gap-4">
          {ticket.status === 'closed' ? (
            <p className="text-sm font-black uppercase opacity-40">{t('conversation_closed')}</p>
          ) : (
            <>
              <p className="text-sm font-black uppercase tracking-widest text-black dark:text-white">{t('waiting_for_expert')}</p>
              <button
                onClick={onJoin}
                disabled={joinDisabled}
                className={`px-6 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest transition-all ${joinDisabled
                  ? 'opacity-20 cursor-not-allowed'
                  : 'bg-black dark:bg-white text-white dark:text-black hover:invert'
                  }`}
              >
                {t('join')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
