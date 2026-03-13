import { useT } from '../i18n';
import { usePartner } from '../hooks/usePartner';
import MessageBubble from './MessageBubble';
import { Ticket, Message } from '../types';

const DEPT_COLOR: Record<string, string> = {
  DSC: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  FOT: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
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
      <div className="bg-solarized-base3 dark:bg-brand-800 rounded-xl shadow-sm border border-solarized-base2 dark:border-brand-700 flex flex-col h-full">
        {/* Preview header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-solarized-base2 dark:border-brand-700 bg-solarized-base2/50 dark:bg-brand-900 rounded-t-xl">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
             <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${DEPT_COLOR[ticket.dept] || DEPT_COLOR[ticket.dept.toUpperCase()] || 'bg-gray-100 text-gray-700'}`}>
              {ticket.dept}
            </span>
            <span className="text-sm font-semibold text-solarized-base01 dark:text-gray-100 truncate">{ticket.agentName}</span>
            {(ticket.ref1 || (ticket as any).cdbId) && (
              <span className="text-xs font-mono bg-solarized-base2 dark:bg-gray-700 text-solarized-base01 dark:text-gray-300 px-2 py-0.5 rounded">
                {ticket.dept === 'FOT' || ticket.dept === 'fot' ? manifest.ref2Label : manifest.ref1Label}: {ticket.ref1 || (ticket as any).cdbId}
              </span>
            )}
            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded font-medium shrink-0">
              Preview — read only
            </span>
          </div>
          <button onClick={onClose} className="text-solarized-base1 hover:text-solarized-base01 dark:hover:text-gray-200 text-lg leading-none ml-2">×</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {!messages || !Array.isArray(messages) || messages.length === 0 ? (
            <p className="text-center text-solarized-base1 text-sm mt-8">{t('no_messages')}</p>
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} ticketId={ticket.id} />
            ))
          )}
        </div>

        {/* Join bar */}
        <div className="px-4 py-3 border-t border-solarized-base2 dark:border-brand-700 bg-solarized-base2/50 dark:bg-brand-900 rounded-b-xl flex items-center justify-between gap-4">
          {ticket.status === 'closed' ? (
            <p className="text-sm text-solarized-base1 italic">This conversation has been closed.</p>
          ) : (
            <>
              <p className="text-sm text-solarized-base1 dark:text-gray-400">{t('waiting_for_expert')}</p>
              <button
                onClick={onJoin}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors shrink-0 ${joinDisabled
                  ? 'bg-brand-500/50 text-white/90'
                  : 'bg-brand-500 text-white hover:bg-brand-600'
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
