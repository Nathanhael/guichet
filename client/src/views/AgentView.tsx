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
import AgentTicketSidebar from '../components/agent/AgentTicketSidebar';
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
    focusMode,
    memberships,
    activeMembershipId,
    unreadTickets,
    queuePosition,
  } = useStoreShallow((s) => ({
    user: s.user,
    tickets: s.tickets,
    setTickets: s.setTickets,
    activeTicketId: s.activeTicketId,
    setActiveTicketId: s.setActiveTicketId,
    focusMode: s.focusMode,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    unreadTickets: s.unreadTickets,
    queuePosition: s.queuePosition,
  }));

  const t = useT();
  const [showFeedback, setShowFeedback] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  // Agent's non-closed tickets for the sidebar
  const agentTickets = useMemo(
    () => tickets.filter((tk) => tk.agentId === user?.id && tk.status !== 'closed'),
    [tickets, user?.id],
  );
  const unreadCount = useMemo(
    () => agentTickets.filter((tk) => !!unreadTickets[tk.id]).length,
    [agentTickets, unreadTickets],
  );
  const showSidebar = agentTickets.length > 0;

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
      <div className={`h-full bg-transparent flex flex-col overflow-hidden relative ${focusMode ? 'zen-mode' : ''}`}>
        <SystemBackground />

        <AgentNav
          logoUrl={manifest.logoUrl}
          partnerName={activeMembership.partnerName}
          industry={manifest.industry}
          showSidebar={showSidebar}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onShowFeedback={() => setShowFeedback(true)}
        />

        <div className="flex-1 overflow-hidden flex">
          {showSidebar && (
            <AgentTicketSidebar
              tickets={agentTickets}
              unreadCount={unreadCount}
              isOpen={!focusMode && sidebarOpen}
            />
          )}

          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            {/* Queue position indicator */}
            {queuePosition && queuePosition.position > 0 && !activeTicket && agentTickets.some(tk => tk.status === 'open') && (
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
            {activeTicket ? (
              <div className="flex-1 min-h-0 w-full">
                <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg-base)]">
                  <ChatWindow key={activeTicket.id} ticket={activeTicket} onClose={() => setActiveTicketId(null)} />
                </div>
              </div>
            ) : (
              <TicketForm manifest={manifest} />
            )}
          </div>
        </div>
      </div>

      <RatingModal />
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      <PwaInstallPrompt />
    </BusinessHoursGuard>
    </ErrorBoundary>
  );
}
