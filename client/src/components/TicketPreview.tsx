import { useT } from '../i18n';
import { usePartner } from '../hooks/usePartner';
import MessageBubble from './MessageBubble';
import { Ticket, Message } from '../types';

const DEPT_COLOR: Record<string, string> = {
  DSC: 'bg-black text-white dark:bg-white dark:text-black',
  FOT: 'bg-white text-black dark:bg-black dark:text-white',
};

interface TicketPreviewProps {
  ticket: Ticket;
  messages: Message[];
  onJoin: () => void;
  onClose: () => void;
  joinDisabled?: boolean;
}

export default function TicketPreview({ ticket, messages, onJoin, onClose, joinDisabled }: TicketPreviewProps) {
  const t = useT();
  const { manifest } = usePartner();
  
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
              Preview Mode
            </span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center border-2 border-black dark:border-white font-black hover:invert transition-all">×</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-1 bg-white dark:bg-black">
          {!messages || !Array.isArray(messages) || messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20">
              <p className="text-sm font-black uppercase tracking-widest">{t('no_messages')}</p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} ticketId={ticket.id} />
            ))
          )}
        </div>

        {/* Join bar */}
        <div className="px-6 py-4 border-t-2 border-black dark:border-white bg-white dark:bg-black flex items-center justify-between gap-4">
          {ticket.status === 'closed' ? (
            <p className="text-sm font-black uppercase opacity-40">Conversation closed.</p>
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
