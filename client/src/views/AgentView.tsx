import { useEffect, useState, useMemo } from 'react';
import useStore from '../store/useStore';
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
import { trpc } from '../utils/trpc';
import { Ticket } from '../types';

export default function AgentView() {
  const user = useStore((s) => s.user);
  const tickets = useStore((s) => s.tickets);
  const setTickets = useStore((s) => s.setTickets);
  const activeTicketId = useStore((s) => s.activeTicketId);
  const setActiveTicketId = useStore((s) => s.setActiveTicketId);
  const focusMode = useStore((s) => s.focusMode);
  const memberships = useStore((s) => s.memberships);
  const activeMembershipId = useStore((s) => s.activeMembershipId);
  const unreadTickets = useStore((s) => s.unreadTickets);
  const queuePosition = useStore((s) => s.queuePosition);

  const t = useT();
  const [showFeedback, setShowFeedback] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Keep business hours store fresh even when TicketForm is unmounted (agent in active chat)
  useBusinessHours();

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
    () => agentTickets.filter((tk) => unreadTickets.has(tk.id)).length,
    [agentTickets, unreadTickets],
  );
  const showSidebar = agentTickets.length > 0;

  // tRPC ticket list
  const { data: ticketList } = trpc.ticket.list.useQuery(
    { agentId: user?.id },
    { enabled: !!user?.id },
  );

  useEffect(() => {
    if (ticketList) {
      setTickets(ticketList as unknown as Ticket[]);
    }
  }, [ticketList, setTickets]);

  const activeTicket = tickets.find((tk) => tk.id === activeTicketId);

  if (!user) return null;
  if (!activeMembership) return <PartnerUnavailable />;

  return (
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
    </BusinessHoursGuard>
  );
}
