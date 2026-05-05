import { useMemo } from 'react';
import { Ticket } from '../../types';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';

interface AgentChatHeaderProps {
  ticket: Ticket;
}

/**
 * Slim top-edge header for AgentView's chat pane. Sister components
 * (AgentTicketContextPanel, ChatHeader for support) already carry the
 * conversation metadata; this just gives the chat pane a visual anchor
 * so it doesn't start cold against the page chrome.
 *
 * Intentionally minimal: department badge + short ticket reference. Status,
 * participants, references and the close action live in the left sidebar.
 */
export default function AgentChatHeader({ ticket }: AgentChatHeaderProps) {
  const t = useT();
  const { memberships, activeMembershipId } = useStoreShallow((s) => ({
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
  }));

  const departmentName = useMemo(() => {
    const m = (memberships || []).find((x) => x.id === activeMembershipId);
    const depts = (m?.manifest?.departments || []) as { id: string; name: string }[];
    return depts.find((d) => d.id === ticket.dept)?.name || ticket.dept;
  }, [memberships, activeMembershipId, ticket.dept]);

  const isClosed = ticket.status === 'closed';
  const shortId = ticket.id.slice(0, 8);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] font-semibold px-2 py-0.5 shrink-0 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          {departmentName}
        </span>
        {isClosed && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-[var(--radius-pill)] shrink-0 bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)]">
            {t('status_closed')}
          </span>
        )}
      </div>
      <span className="font-mono text-[11px] text-[var(--color-ink-muted)] shrink-0 select-text" title={ticket.id}>
        #{shortId}
      </span>
    </div>
  );
}
