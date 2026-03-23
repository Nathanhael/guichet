import { useEffect, useState, useMemo } from 'react';
import useStore from '../store/useStore';
import { useBusinessHours } from '../hooks/useBusinessHours';
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
      <div className={`h-full bg-transparent flex flex-col overflow-hidden relative transition-all duration-700 ${focusMode ? 'zen-mode' : ''}`}>
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
              isOpen={sidebarOpen}
            />
          )}

          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            {activeTicket ? (
              <div className="flex-1 min-h-0 w-full animate-fade-in">
                <div className="h-full flex flex-col overflow-hidden bg-white/50 backdrop-blur-md dark:bg-brand-900/40">
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
