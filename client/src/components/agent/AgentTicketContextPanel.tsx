import { useEffect, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { Ticket } from '../../types';
import { useT } from '../../i18n';
import { useStoreShallow } from '../../store/useStore';
import { getTicketTime } from '../../utils/dateUtils';
import Avatar from '../ui/Avatar';

interface AgentTicketContextPanelProps {
  ticket: Ticket;
  onRequestClose: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{label}</span>
      <div className="text-[13px] text-[var(--color-ink)]">{children}</div>
    </div>
  );
}

export default function AgentTicketContextPanel({ ticket, onRequestClose }: AgentTicketContextPanelProps) {
  const t = useT();
  const { memberships, activeMembershipId } = useStoreShallow((s) => ({
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
  }));

  const activeMembership = (memberships || []).find((m) => m.id === activeMembershipId);
  const departments = (activeMembership?.manifest?.departments || []) as { id: string; name: string }[];
  const departmentName = departments.find((d) => d.id === ticket.dept)?.name || ticket.dept;

  const allRefs = ticket.references || [];

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  useEffect(() => {
    if (copiedIdx === null) return;
    const id = window.setTimeout(() => setCopiedIdx(null), 1500);
    return () => window.clearTimeout(id);
  }, [copiedIdx]);

  const copyRef = (value: string, idx: number) => {
    void navigator.clipboard.writeText(value).then(() => setCopiedIdx(idx));
  };

  const isClosed = ticket.status === 'closed';
  const supportJoined = !!ticket.supportId && !!ticket.supportName;

  const statusLabel = isClosed
    ? t('status_closed')
    : t('waiting_for_support');

  const statusDot = isClosed
    ? 'bg-[var(--color-ink-muted)]'
    : 'bg-[var(--color-accent-amber)]';

  return (
    <div className="flex flex-col gap-4">
      {supportJoined && !isClosed ? (
        <div className="flex items-center gap-2.5 animate-[v2p-pop_180ms_ease-out]">
          <Avatar name={ticket.supportName!} size={36} statusDot="online" />
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
              {t('connected_with')}
            </span>
            <span className="text-[13px] font-semibold text-[var(--color-ink)] truncate">
              {ticket.supportName}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
          <span className="text-[12px] font-medium text-[var(--color-ink)] truncate">{statusLabel}</span>
        </div>
      )}

      <Row label={t('department')}>
        <span className="inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] text-[11px] font-semibold px-2 py-0.5 leading-none">
          {departmentName}
        </span>
      </Row>

      {ticket.agentLang && (
        <Row label={t('language')}>
          <span className="inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] text-[11px] font-medium px-1.5 py-0.5">
            {ticket.agentLang.toUpperCase()}
          </span>
        </Row>
      )}

      {allRefs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
            {t('references')}
          </span>
          {allRefs.map((ref, idx) => (
            <button
              key={`${ref.label}-${idx}`}
              type="button"
              onClick={() => copyRef(ref.value, idx)}
              className="flex items-center justify-between gap-2 w-full px-2 py-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-left transition-colors group"
              title={`${ref.label}: ${ref.value}`}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{ref.label}</span>
                <span className="text-[12px] font-medium text-[var(--color-ink)] truncate tabular-nums">{ref.value}</span>
              </div>
              {copiedIdx === idx ? (
                <Check className="h-3.5 w-3.5 text-[var(--color-ok)] shrink-0" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-[var(--color-ink-muted)] opacity-0 group-hover:opacity-100 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}

      <Row label={t('started')}>
        <span className="text-[12px] text-[var(--color-ink-soft)] tabular-nums">{getTicketTime(ticket.createdAt)}</span>
      </Row>

      {!isClosed && (
        <button
          type="button"
          onClick={onRequestClose}
          className="mt-2 w-full h-9 flex items-center justify-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-danger-soft)] text-[var(--color-ink)] hover:text-[var(--color-danger)] text-[13px] font-medium transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          {t('close')}
        </button>
      )}
    </div>
  );
}
