import { useT } from '../../i18n';
import { Ticket } from '../../types';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';
import { getTicketTime } from '../../utils/dateUtils';
import SlaIndicator from '../SlaIndicator';

interface TicketPreviewCardProps {
  ticket: Ticket;
  onJoin: (ticket: Ticket) => void;
}

export default function TicketPreviewCard({ ticket, onJoin }: TicketPreviewCardProps) {
  const t = useT();
  const allLabels = useStore((s) => s.allLabels);

  // Fetch last 3 messages for preview
  const { data: messagesData } = trpc.message.list.useQuery(
    { ticketId: ticket.id, limit: 3 },
    { enabled: !!ticket.id },
  );
  const messages = messagesData?.messages || [];

  return (
    <div className="flex-1 flex items-start justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-2xl border border-border bg-bg-surface">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-wide border border-accent-blue text-accent-blue px-2 py-0.5">
              {ticket.dept}
            </span>
            {ticket.slaResponseDueAt && (
              <SlaIndicator dueAt={ticket.slaResponseDueAt} breached={ticket.slaBreached} />
            )}
          </div>
          <h3 className="text-sm font-bold text-text-primary">{ticket.agentName}</h3>
          <div className="flex items-center gap-3 mt-1 text-[9px] font-mono text-text-muted uppercase">
            <span>{ticket.status}</span>
            <span>{getTicketTime(ticket.createdAt)}</span>
          </div>
        </div>

        {/* Labels */}
        {ticket.labels && ticket.labels.length > 0 && (
          <div className="px-5 py-2 border-b border-border flex gap-1.5 flex-wrap">
            {ticket.labels.map((labelId) => {
              const info = allLabels.find((l) => l.id === labelId);
              if (!info) return null;
              return (
                <span key={labelId} className="text-[9px] font-mono font-bold uppercase bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[var(--color-text-secondary)]">
                  {info.name}
                </span>
              );
            })}
          </div>
        )}

        {/* Last 3 messages */}
        <div className="px-5 py-4">
          <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-text-muted mb-3">
            {t('recent_messages') || 'Recent Messages'}
          </div>
          {messages.length === 0 ? (
            <p className="text-text-muted text-xs">{t('no_data') || 'No messages'}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((msg) => (
                <div key={msg.id} className="border-l-2 border-border pl-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold text-text-primary">{msg.senderName}</span>
                    <span className="text-[9px] font-mono text-text-muted">{getTicketTime(msg.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">{msg.processedText || msg.originalText}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Join button */}
        <div className="px-5 py-4 border-t border-border">
          <button
            onClick={() => onJoin(ticket)}
            className="w-full py-2.5 text-xs font-bold uppercase tracking-wide bg-accent-blue text-[var(--color-btn-text-inverse)] hover:bg-accent-blue-light"
          >
            {t('join_ticket') || 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}
