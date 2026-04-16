import { useEffect, useState, useMemo } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useBusinessHours } from '../hooks/useBusinessHours';
import { useT } from '../i18n';
import ChatWindow from '../components/ChatWindow';
import SystemBackground from '../components/SystemBackground';
import BusinessHoursGuard from '../components/BusinessHoursGuard';
import FeedbackModal from '../components/FeedbackModal';
import RatingModal from '../components/RatingModal';
import PartnerUnavailable from '../components/PartnerUnavailable';
import AgentNav from '../components/agent/AgentNav';
import TicketForm from '../components/agent/TicketForm';
import PwaInstallPrompt from '../components/PwaInstallPrompt';
import { trpc } from '../utils/trpc';
import { Ticket } from '../types';

export default function AgentView() {
  const {
    user,
    tickets,
    setTickets,
    activeTicketId,
    setActiveTicketId,
    memberships,
    activeMembershipId,
    queuePosition,
  } = useStoreShallow((s) => ({
    user: s.user,
    tickets: s.tickets,
    setTickets: s.setTickets,
    activeTicketId: s.activeTicketId,
    setActiveTicketId: s.setActiveTicketId,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    queuePosition: s.queuePosition,
  }));

  const t = useT();
  const [showFeedback, setShowFeedback] = useState(false);

  // Keep business hours store fresh even when TicketForm is unmounted (agent in active chat)
  useBusinessHours();

  // Handle service worker postMessage for notification click navigation
  useEffect(() => {
    function handleSwMessage(event: MessageEvent) {
      if (event.data?.type === 'NAVIGATE_TICKET' && event.data.ticketId) {
        setActiveTicketId(event.data.ticketId as string);
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
  }, [setActiveTicketId]);

  // Handle ?ticket= URL param on load (e.g. opened from push notification when app was closed)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticketId = params.get('ticket');
    if (ticketId) {
      setActiveTicketId(ticketId);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [setActiveTicketId]);

  const activeMembership = (memberships || []).find((m) => m.id === activeMembershipId);
  const manifest = useMemo(
    () => activeMembership?.manifest || { industry: 'general', departments: [] },
    [activeMembership?.manifest],
  );

  // Agent's non-closed ticket (1-ticket limit)
  const agentTicket = useMemo(
    () => tickets.find((tk) => tk.agentId === user?.id && tk.status !== 'closed') ?? null,
    [tickets, user?.id],
  );

  // Auto-route to the agent's open ticket. Agents have a 1-ticket limit and
  // cannot "leave" the chat panel — the only way out is to close the ticket.
  useEffect(() => {
    if (agentTicket && !activeTicketId) {
      setActiveTicketId(agentTicket.id);
    }
  }, [agentTicket, activeTicketId, setActiveTicketId]);

  // tRPC ticket list
  const { data: ticketList } = trpc.ticket.list.useQuery(
    { agentId: user?.id },
    { enabled: !!user?.id },
  );

  useEffect(() => {
    if (ticketList && Array.isArray(ticketList)) {
      // tRPC infers Drizzle row types which differ slightly from client Ticket interface
      // (e.g. participants as JSONB object vs typed array). Runtime data is compatible.
      setTickets(ticketList as unknown as Ticket[]);
    }
  }, [ticketList, setTickets]);

  const activeTicket = tickets.find((tk) => tk.id === activeTicketId);

  if (!user) return null;
  if (!activeMembership) return <PartnerUnavailable />;

  return (
    <ErrorBoundary>
    <BusinessHoursGuard mode={activeTicket ? 'notice' : 'block'}>
      <div className="h-full bg-transparent flex flex-col overflow-hidden relative">
        <SystemBackground />

        <AgentNav
          partnerName={activeMembership.partnerName}
          onShowFeedback={() => setShowFeedback(true)}
        />

        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            {/* Queue position indicator */}
            {queuePosition && queuePosition.position > 0 && !activeTicket && agentTicket?.status === 'open' && (
              <div className="px-6 py-3 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 border border-[var(--color-border)] text-[var(--color-text-primary)] text-xs font-bold font-mono">
                  {queuePosition.position}
                </div>
                <div>
                  <p className="text-sm font-bold text-[var(--color-text-primary)]">
                    {t('queue_position') || 'Queue position'}: #{queuePosition.position}
                  </p>
                  {queuePosition.etaMins > 0 && (
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {t('estimated_wait') || 'Estimated wait'}: ~{queuePosition.etaMins} {t('minutes') || 'min'}
                    </p>
                  )}
                </div>
              </div>
            )}
            {activeTicket && activeTicket.status !== 'closed' ? (
              <div className="flex-1 min-h-0 w-full">
                <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg-base)]">
                  <ChatWindow key={activeTicket.id} ticket={activeTicket} />
                </div>
              </div>
            ) : (
              // Closed/resolved → fall through to the new-ticket form. The agent's
              // 1-ticket limit is already enforced by the agentTicket memo, so as
              // soon as their open ticket is closed (by them or by support), the
              // ticket row is filtered out and they can submit a new one. The
              // RatingModal (driven by ratingPrompt in the store) overlays this
              // view when a support agent had joined.
              <TicketForm manifest={manifest} />
            )}
          </div>
        </div>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      <PwaInstallPrompt />
    </BusinessHoursGuard>
    <RatingModal />
    </ErrorBoundary>
  );
}
