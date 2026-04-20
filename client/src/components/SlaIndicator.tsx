import { useEffect } from 'react';
import { trpc } from '../utils/trpc';
import { getSocket } from '../hooks/useSocket';
import Pill from './ui/Pill';

interface Props {
  ticketId: string;
  hidden?: boolean; // caller sets true for 'agent' role
}

export default function SlaIndicator({ ticketId, hidden }: Props) {
  const { data, refetch } = trpc.sla.getTicketState.useQuery({ ticketId }, { refetchInterval: 60_000 });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onBreach = (p: { ticketId: string }) => { if (p.ticketId === ticketId) refetch(); };
    const onResolved = (p: { ticketId: string }) => { if (p.ticketId === ticketId) refetch(); };
    socket.on('sla:breach', onBreach);
    socket.on('sla:resolved', onResolved);
    return () => {
      socket.off('sla:breach', onBreach);
      socket.off('sla:resolved', onResolved);
    };
  }, [ticketId, refetch]);

  if (hidden) return null;
  if (!data || data.status === 'disabled') return null;

  if (data.status === 'met') {
    return <Pill tone="ok">SLA met</Pill>;
  }
  if (data.status === 'ok') {
    return <Pill tone="muted">SLA: {data.remainingMinutes}m left</Pill>;
  }
  if (data.status === 'warning') {
    return (
      <span
        className="inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-semibold leading-none"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-accent-amber) 14%, transparent)',
          color: 'var(--color-accent-amber)',
        }}
      >
        SLA: {data.remainingMinutes}m left
      </span>
    );
  }
  if (data.status === 'breached') {
    return <Pill tone="urgent">SLA: {data.overdueMinutes}m over</Pill>;
  }
  return null;
}
