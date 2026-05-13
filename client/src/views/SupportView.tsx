import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import AiDisclosureBanner from '../components/AiDisclosureBanner';
import useStore from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { getSocket } from '../hooks/useSocket';
import { useBusinessHours } from '../hooks/useBusinessHours';
import { useT } from '../i18n';
import { MAX_OPEN_CHATS } from '../config';
import ChatWindow from '../components/ChatWindow';
import TicketPreview from '../components/TicketPreview';
import PartnerUnavailable from '../components/PartnerUnavailable';
import UserMenuChip from '../components/ui/UserMenuChip';
import QueueSidebar from '../components/support/QueueSidebar';
import ChatTabBar from '../components/support/ChatTabBar';
import TicketSidebar from '../components/support/TicketSidebar';
import ResizablePanel from '../components/ResizablePanel';
import SplitChatLayout from '../components/support/SplitChatLayout';
import { requestNotificationPermission } from '../utils/notifications';
import { formatBusinessHoursTimestamp, getBusinessHoursReason } from '../utils/businessHours';
import { Ticket } from '../types';
import type { ChatWindowHandle } from '../types/command';
import { trpc } from '../utils/trpc';
import { useSupportTabRestore } from '../hooks/useSupportTabRestore';
import { useSupportCommands } from '../hooks/useSupportCommands';
import CommandPalette from '../components/support/CommandPalette';
import KeyboardShortcutsModal from '../components/support/KeyboardShortcutsModal';
import { useIdleStatus } from '../hooks/useIdleStatus';
import { Clock, ChevronLeft } from 'lucide-react';

export default function SupportView() {
  const {
    user,
    tickets,
    setTickets,
    supportOpenTickets,
    addSupportOpenTicket,
    removeSupportOpenTicket,
    clearUnread,
    focusMode,
    viewMode,
    setViewMode,
    memberships,
    activeMembershipId,
    notificationsEnabled,
    rightSidebarExpanded,
    toggleRightSidebar,
    setAllLabels,
  } = useStore(
    useShallow((s) => ({
      user: s.user,
      tickets: s.tickets,
      setTickets: s.setTickets,
      supportOpenTickets: s.supportOpenTickets,
      addSupportOpenTicket: s.addSupportOpenTicket,
      removeSupportOpenTicket: s.removeSupportOpenTicket,
      clearUnread: s.clearUnread,
      focusMode: s.focusMode,
      viewMode: s.viewMode,
      setViewMode: s.setViewMode,
      memberships: s.memberships,
      activeMembershipId: s.activeMembershipId,
      notificationsEnabled: s.notificationsEnabled,
      rightSidebarExpanded: s.rightSidebarExpanded,
      toggleRightSidebar: s.toggleRightSidebar,
      setAllLabels: s.setAllLabels,
    }))
  );
  const { status: businessHoursStatus } = useBusinessHours();
  const t = useT();
  useIdleStatus();

  // tRPC ticket list (poll every 30s). Kept at this level because (a) it
  // feeds the zustand mirror just below and (b) it's the source of truth
  // the tab-restore hook reads to merge localStorage tabs with server-owned
  // tickets.
  const ticketsQuery = trpc.ticket.list.useQuery({}, { refetchInterval: 30000 });

  const { activeTab, setActiveTab } = useSupportTabRestore(ticketsQuery);

  const [previewTicket, setPreviewTicket] = useState<Ticket | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('queueSidebarOpen') !== 'false');
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => {
      localStorage.setItem('queueSidebarOpen', String(!v));
      return !v;
    });
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const chatWindowRef = useRef<ChatWindowHandle>(null);

  const activeMembership = (memberships || []).find((m) => m.id === activeMembershipId);

  // Request notification permission once when enabled
  useEffect(() => {
    if (notificationsEnabled) requestNotificationPermission();
  }, [notificationsEnabled]);

  // Mirror server tickets into the zustand store. The polling query lives
  // above; this is the one-way ingestion path. The tab-restore hook reads
  // `ticketsQuery.data` directly to dodge an ordering trap where this
  // effect commits AFTER restore-on-mount on the same render (see hook
  // comment for the full why).
  useEffect(() => {
    if (ticketsQuery.data && Array.isArray(ticketsQuery.data)) {
      setTickets(ticketsQuery.data);
    }
  }, [ticketsQuery.data, setTickets]);

  // Populate label store so ChatHeader's label picker has data in support views
  const labelsQuery = trpc.label.list.useQuery();
  useEffect(() => {
    if (labelsQuery.data) setAllLabels(labelsQuery.data);
  }, [labelsQuery.data, setAllLabels]);

  // Derived state
  const openTabTickets = useMemo(
    () => supportOpenTickets.map((id) => tickets.find((tk) => tk.id === id)).filter((tk): tk is Ticket => !!tk),
    [supportOpenTickets, tickets],
  );
  const showPreview = !!previewTicket && !supportOpenTickets.includes(previewTicket.id);
  const atMaxChats = openTabTickets.length >= MAX_OPEN_CHATS;

  // Queue count for collapsed sidebar badge. "Queue" = unclaimed work
  // waiting for pickup; tickets already claimed by me or other agents
  // live in their own sections and are not counted here.
  const queueCount = useMemo(() => {
    if (!activeMembership) return 0;
    const assignedDepts = activeMembership.departments || [];
    const isGeneralist = assignedDepts.length === 0;
    return tickets.filter(
      (tk) =>
        tk.status !== 'closed' &&
        !tk.supportId &&
        (isGeneralist || assignedDepts.includes(tk.dept)),
    ).length;
  }, [tickets, activeMembership]);

  // Active ticket for the right sidebar
  const activeTicket = useMemo(
    () => (activeTab ? tickets.find((tk) => tk.id === activeTab) ?? null : null),
    [activeTab, tickets],
  );

  // Keep activeTab pointing at a valid tab as the open-tab set changes.
  // Cross-render state dependency, can't be purely derived.
  useEffect(() => {
    if (openTabTickets.length === 0) {
      setActiveTab(null);
      return;
    }
    if (!activeTab || !openTabTickets.some((tk) => tk.id === activeTab)) {
      setActiveTab(openTabTickets[0].id);
    }
  }, [openTabTickets, activeTab, setActiveTab]);

  // Clear the preview pane if the previewed ticket was subsequently opened as a tab.
  useEffect(() => {
    if (previewTicket && supportOpenTickets.includes(previewTicket.id)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewTicket(null);
    }
  }, [supportOpenTickets, previewTicket]);

  const isSplitView = viewMode === 'split-grid' || viewMode === 'split-stack';

  // Auto-fallback from split-stack when fewer than 2 tabs open (grid keeps empty slots)
  useEffect(() => {
    if (viewMode === 'split-stack' && supportOpenTickets.length < 2) {
      setViewMode('normal');
    }
  }, [viewMode, supportOpenTickets.length, setViewMode]);

  // Auto-fallback from split views on narrow viewports
  useEffect(() => {
    if (!isSplitView) return;
    const check = () => {
      if (window.innerWidth < 768) setViewMode('normal');
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [isSplitView, setViewMode]);

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
    getSocket()?.emit('support:join', {
      ticketId: ticket.id,
      supportId: user.id,
      supportName: user.name,
      supportLang: user.lang || 'en',
    });
    addSupportOpenTicket(ticket.id);
    setActiveTab(ticket.id);
    clearUnread(ticket.id);
    setPreviewTicket(null);
  }

  const closeTab = useCallback((ticketId: string) => {
    // Notify server so it unassigns the agent from the ticket
    const ticket = tickets.find((tk) => tk.id === ticketId);
    if (ticket && ticket.status !== 'closed') {
      getSocket()?.emit('support:leave', { ticketId });
    }
    removeSupportOpenTicket(ticketId);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((tk) => tk.id !== ticketId);
      setActiveTab(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [tickets, removeSupportOpenTicket, activeTab, openTabTickets, setActiveTab]);

  // Command palette + global keyboard shortcuts wiring. selectTab is
  // re-exported because the tab bar + split layout click handlers want the
  // "switch then focus compose" behavior, which lives inside the hook.
  const { commands, selectTab } = useSupportCommands({
    activeTab,
    setActiveTab,
    openTabTickets,
    closeTab,
    chatWindowRef,
    toggleSidebar,
    setSidebarOpen,
    paletteOpen,
    onOpenPalette: () => setPaletteOpen(true),
  });

  // ── Guards ──

  if (!user) return null;
  if (!activeMembership) return <PartnerUnavailable />;

  // ── Render ──

  return (
    <ErrorBoundary>
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <AiDisclosureBanner />
      {/* Business hours notice bar */}
      {businessHoursStatus && !businessHoursStatus.isOpen && (
        <div className="px-8 py-2 bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-b border-[var(--color-border)] text-xs font-bold">
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

      <div className="flex flex-1 overflow-hidden relative gap-3 p-3">
        {activeMembership && viewMode !== 'focus' && (
          <ResizablePanel
            side="left"
            storageKey="queueSidebarWidth"
            defaultWidth={320}
            minWidth={200}
            maxWidth={480}
            isOpen={sidebarOpen}
            onToggle={toggleSidebar}
            collapsedLabel={t('queue')}
            collapsedBadge={queueCount}
            toggleTitle="Ctrl+B"
          >
            <div className="flex flex-col h-full">
              <div className="px-2 pt-3 pb-2 border-b border-[var(--color-border)] flex-shrink-0 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <UserMenuChip
                    showStatus
                    showKeyboardShortcuts
                    onKeyboardShortcuts={() => setShortcutsOpen(true)}
                    confirmBeforeSwitch
                  />
                </div>
                <button
                  onClick={toggleSidebar}
                  title="Ctrl+B"
                  aria-label={t('collapse_sidebar')}
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[var(--radius-btn)] border border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)] transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                <QueueSidebar
                  activeMembership={activeMembership}
                  activeTab={activeTab}
                  previewTicketId={previewTicket?.id || null}
                  atMaxChats={atMaxChats}
                  onSelectTicket={selectTicket}
                  onPreviewArchived={(ticket) => setPreviewTicket(ticket)}
                />
              </div>
            </div>
          </ResizablePanel>
        )}

        <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
          <ChatTabBar
            tabs={openTabTickets}
            activeTab={activeTab}
            onSelectTab={selectTab}
            onCloseTab={closeTab}
          />

          <div className="flex-1 overflow-hidden flex">
            <div className="flex-1 overflow-hidden relative">
              {isSplitView ? (
                <>
                  <SplitChatLayout
                    tabs={openTabTickets}
                    activeTab={activeTab}
                    viewMode={viewMode}
                    onSelectTab={selectTab}
                    onCloseTab={closeTab}
                  />
                  {/* Overlay preview on top of split layout so queue → preview → join works */}
                  {showPreview && previewTicket && (() => {
                    const pt = previewTicket;
                    const isTerminal = pt.status === 'closed';
                    return (
                      <div className="absolute inset-0 z-10 bg-[var(--color-bg-base)]">
                        <TicketPreview
                          ticket={pt}
                          onJoin={isTerminal ? undefined : () => joinTicket(pt)}
                          onClose={() => setPreviewTicket(null)}
                          joinDisabled={atMaxChats}
                          readOnly={isTerminal}
                        />
                      </div>
                    );
                  })()}
                </>
              ) : showPreview && previewTicket ? (() => {
                const pt = previewTicket;
                const isTerminal = pt.status === 'closed';
                return (
                  <TicketPreview
                    ticket={pt}
                    onJoin={isTerminal ? undefined : () => joinTicket(pt)}
                    onClose={() => setPreviewTicket(null)}
                    joinDisabled={atMaxChats}
                    readOnly={isTerminal}
                  />
                );
              })() : activeTab && tickets.find((tk) => tk.id === activeTab) ? (
                <ChatWindow
                  ref={chatWindowRef}
                  key={activeTab}
                  ticket={tickets.find((tk) => tk.id === activeTab)!}
                  onClose={() => closeTab(activeTab)}
                />
              ) : (
                <div className="h-full flex items-center justify-center font-bold uppercase tracking-wide opacity-20 text-2xl">
                  {t('ready_to_help')}
                </div>
              )}
            </div>

            {/* Ticket context sidebar (only in normal mode) */}
            {activeTicket && !showPreview && !focusMode && viewMode === 'normal' && (
              <ResizablePanel
                side="right"
                storageKey="ticketSidebarWidth"
                defaultWidth={288}
                minWidth={200}
                maxWidth={420}
                isOpen={rightSidebarExpanded}
                onToggle={toggleRightSidebar}
                collapsedLabel={t('ticket_context')}
                collapsedIcon={<Clock className="h-4 w-4 opacity-40" />}
              >
                <TicketSidebar
                  ticket={activeTicket}
                  onPreviewTicket={setPreviewTicket}
                  onToggle={toggleRightSidebar}
                />
              </ResizablePanel>
            )}
          </div>
        </main>
      </div>

      {/* Command Palette overlay */}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
    </ErrorBoundary>
  );
}
