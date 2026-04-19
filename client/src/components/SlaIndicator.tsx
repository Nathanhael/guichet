import { useEffect } from 'react';
import { trpc } from '../utils/trpc';
import { getSocket } from '../hooks/useSocket';

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
    return <span className="mono-label px-2 py-0.5 border border-[var(--color-accent-green)] text-[var(--color-accent-green)]">SLA MET</span>;
  }
  if (data.status === 'ok') {
    return <span className="mono-label px-2 py-0.5 text-[var(--color-text-secondary)]">SLA: {data.remainingMinutes}m left</span>;
  }
  if (data.status === 'warning') {
    return <span className="mono-label px-2 py-0.5 border border-[var(--color-accent-amber)] text-[var(--color-accent-amber)]">SLA: {data.remainingMinutes}m left</span>;
  }
  if (data.status === 'breached') {
    return <span className="mono-label px-2 py-0.5 border border-[var(--color-accent-red)] text-[var(--color-accent-red)]">SLA: {data.overdueMinutes}m over</span>;
  }
  return null;
}
