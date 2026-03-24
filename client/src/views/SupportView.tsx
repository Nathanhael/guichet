import { useEffect, useState, useMemo } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { useBusinessHours } from '../hooks/useBusinessHours';
import { useT } from '../i18n';
import { MAX_OPEN_CHATS } from '../config';
import ChatWindow from '../components/ChatWindow';
import TicketPreview from '../components/TicketPreview';
import PartnerUnavailable from '../components/PartnerUnavailable';
import SupportNav from '../components/support/SupportNav';
import QueueSidebar from '../components/support/QueueSidebar';
import ChatTabBar from '../components/support/ChatTabBar';
import CustomerInfoPanel from '../components/support/CustomerInfoPanel';
import { requestNotificationPermission } from '../utils/notifications';
import { formatBusinessHoursTimestamp, getBusinessHoursReason } from '../utils/businessHours';
import { Ticket } from '../types';
import { trpc } from '../utils/trpc';

export default function SupportView() {
  const user = useStore((s) => s.user);
  const tickets = useStore((s) => s.tickets);
  const setTickets = useStore((s) => s.setTickets);
  const supportOpenTickets = useStore((s) => s.supportOpenTickets);
  const addSupportOpenTicket = useStore((s) => s.addSupportOpenTicket);
  const removeSupportOpenTicket = useStore((s) => s.removeSupportOpenTicket);
  const clearUnread = useStore((s) => s.clearUnread);
  const focusMode = useStore((s) => s.focusMode);
  const memberships = useStore((s) => s.memberships);
  const activeMembershipId = useStore((s) => s.activeMembershipId);
  const notificationsEnabled = useStore((s) => s.notificationsEnabled);
  const { status: businessHoursStatus } = useBusinessHours();
  const t = useT();

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [previewTicket, setPreviewTicket] = useState<Ticket | null>(null);

  const activeMembership = (memberships || []).find((m) => m.id === activeMembershipId);
  const partnerName = activeMembership?.partnerName || 'Tessera';
  const logoUrl = activeMembership?.manifest?.logoUrl;

  // Request notification permission once when enabled
  useEffect(() => {
    if (notificationsEnabled) requestNotificationPermission();
  }, [notificationsEnabled]);

  // tRPC ticket list (poll every 30s)
  const ticketsQuery = trpc.ticket.list.useQuery({}, { refetchInterval: 30000 });

  useEffect(() => {
    if (ticketsQuery.data && Array.isArray(ticketsQuery.data)) {
      setTickets(ticketsQuery.data as unknown as Ticket[]);
    }
  }, [ticketsQuery.data, setTickets]);

  // Derived state
  const openTabTickets = useMemo(
    () => supportOpenTickets.map((id) => tickets.find((tk) => tk.id === id)).filter((tk): tk is Ticket => !!tk),
    [supportOpenTickets, tickets],
  );
  const showPreview = !!previewTicket && !supportOpenTickets.includes(previewTicket.id);
  const atMaxChats = openTabTickets.length >= MAX_OPEN_CHATS;

  // Keep activeTab in sync with open tabs
  useEffect(() => {
    if (openTabTickets.length === 0) {
      setActiveTab(null);
      return;
    }
    if (!activeTab || !openTabTickets.some((tk) => tk.id === activeTab)) {
      setActiveTab(openTabTickets[0].id);
    }
  }, [openTabTickets, activeTab]);

  // Clear preview if the ticket was opened as a tab
  useEffect(() => {
    if (previewTicket && supportOpenTickets.includes(previewTicket.id)) {
      setPreviewTicket(null);
    }
  }, [supportOpenTickets, previewTicket]);

  // ── Actions ──

  function selectTicket(ticket: Ticket) {
    if (!user) return;
    if (supportOpenTickets.includes(ticket.id)) {
      setActiveTab(ticket.id);
      clearUnread(ticket.id);
      setPreviewTicket(null);
    } else if (!atMaxChats) {
      setPreviewTicket(ticket);
    }
  }

  function joinTicket(ticket: Ticket) {
    if (!user || atMaxChats) return;
    getSocket().emit('support:join', {
      ticketId: ticket.id,
      supportId: user.id,
      supportName: user.name,
      supportLang: user.lang,
    });
    addSupportOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    clearUnread(ticket.id);
    setPreviewTicket(null);
  }

  function closeTab(ticketId: string) {
    removeSupportOpenTicket(ticketId);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((tk) => tk.id !== ticketId);
      setActiveTab(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  // ── Guards ──

  if (!user) return null;
  if (!activeMembership) return <PartnerUnavailable />;

  // ── Render ──

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-black text-black dark:text-white">
      {/* Business hours notice bar */}
      {businessHoursStatus && !businessHoursStatus.isOpen && (
        <div className="px-8 py-2 bg-black text-white dark:bg-white dark:text-black border-b border-black dark:border-white text-xs font-bold">
          <span>{t('intake_paused')}</span>
          {businessHoursStatus.nextOpenAt && (
            <span className="ml-2 opacity-80">
              {t('reopens_label')} {formatBusinessHoursTimestamp(businessHoursStatus.nextOpenAt, businessHoursStatus.timezone)}
            </span>
          )}
          {getBusinessHoursReason(businessHoursStatus) && (
            <span className="ml-2 opacity-80">
              {t('reason_label')}: {getBusinessHoursReason(businessHoursStatus)}
            </span>
          )}
        </div>
      )}

      <SupportNav partnerName={partnerName} logoUrl={logoUrl} />

      <div className="flex flex-1 overflow-hidden">
        {!focusMode && activeMembership && (
          <QueueSidebar
            activeMembership={activeMembership}
            activeTab={activeTab}
            previewTicketId={previewTicket?.id || null}
            atMaxChats={atMaxChats}
            onSelectTicket={selectTicket}
            onPreviewArchived={(ticket) => setPreviewTicket(ticket)}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-black">
          <ChatTabBar
            tabs={openTabTickets}
            activeTab={activeTab}
            onSelectTab={(id) => setActiveTab(id)}
            onCloseTab={closeTab}
          />

          <div className="flex-1 overflow-hidden flex">
            <div className="flex-1 overflow-hidden">
              {showPreview ? (
                <TicketPreview
                  ticket={previewTicket!}
                  onJoin={() => joinTicket(previewTicket!)}
                  onClose={() => setPreviewTicket(null)}
                  joinDisabled={atMaxChats}
                />
              ) : activeTab ? (
                <ChatWindow
                  key={activeTab}
                  ticket={tickets.find((tk) => tk.id === activeTab)}
                  onClose={() => closeTab(activeTab)}
                />
              ) : (
                <div className="h-full flex items-center justify-center font-black uppercase tracking-[0.2em] opacity-20 text-2xl">
                  {t('ready_to_help')}
                </div>
              )}
            </div>

            {/* Customer context panel */}
            {activeTab && !showPreview && !focusMode && (() => {
              const activeTicket = tickets.find((tk) => tk.id === activeTab);
              return activeTicket ? <CustomerInfoPanel ticket={activeTicket} /> : null;
            })()}
          </div>
        </main>
      </div>
    </div>
  );
}
