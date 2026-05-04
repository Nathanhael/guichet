import { useT } from '../../i18n';
import { Ticket } from '../../types';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';
import { getTicketTime } from '../../utils/dateUtils';
import Button from '../ui/Button';
import Pill from '../ui/Pill';
import SectionLabel from '../ui/SectionLabel';

interface TicketPreviewCardProps {
  ticket: Ticket;
  onJoin: (ticket: Ticket) => void;
}

export default function TicketPreviewCard({ ticket, onJoin }: TicketPreviewCardProps) {
  const t = useT();
  const allLabels = useStore((s) => s.allLabels);

  const { data: messagesData } = trpc.message.list.useQuery(
    { ticketId: ticket.id, limit: 3 },
    { enabled: !!ticket.id },
  );
  const messages = messagesData?.messages || [];

  return (
    <div className="flex-1 flex items-start justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-2">
            <Pill tone="accent">{ticket.dept}</Pill>
            <Pill tone="muted">{ticket.status}</Pill>
          </div>
          <h3 className="text-[16px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{ticket.agentName}</h3>
          <div className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
            {getTicketTime(ticket.createdAt)}
          </div>
        </div>

        {/* Labels */}
        {ticket.labels && ticket.labels.length > 0 && (
          <div className="px-5 py-2 border-b border-[var(--color-border)] flex gap-1.5 flex-wrap">
            {ticket.labels.map((labelId) => {
              const info = allLabels.find((l) => l.id === labelId);
              if (!info) return null;
              return (
                <Pill key={labelId} tone="neutral">{info.name}</Pill>
              );
            })}
          </div>
        )}

        {/* Last 3 messages */}
        <div className="px-5 py-4">
          <SectionLabel className="mb-3">{t('recent_messages')}</SectionLabel>
          {messages.length === 0 ? (
            <p className="text-[12px] text-[var(--color-ink-muted)]">{t('no_data')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((msg) => (
                <div key={msg.id} className="border-l-2 border-[var(--color-border)] pl-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[12px] font-semibold text-[var(--color-ink)]">{msg.senderName}</span>
                    <span className="text-[10px] text-[var(--color-ink-muted)]">{getTicketTime(msg.createdAt)}</span>
                  </div>
                  <p className="text-[12px] text-[var(--color-ink-soft)] leading-relaxed">{msg.processedText || msg.originalText}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Join button */}
        <div className="px-5 py-4 border-t border-[var(--color-border)]">
          <Button variant="primary" size="md" className="w-full" onClick={() => onJoin(ticket)}>
            {t('join_ticket')}
          </Button>
        </div>
      </div>
    </div>
  );
}
