import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import useStore from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
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
import TicketSidebar from '../components/support/TicketSidebar';
import SplitChatLayout from '../components/support/SplitChatLayout';
import { requestNotificationPermission } from '../utils/notifications';
import { formatBusinessHoursTimestamp, getBusinessHoursReason } from '../utils/businessHours';
import { Ticket } from '../types';
import type { Command, ChatWindowHandle } from '../types/command';
import { trpc } from '../utils/trpc';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import CommandPalette from '../components/support/CommandPalette';
import { useIdleStatus } from '../hooks/useIdleStatus';

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
    }))
  );
  const { status: businessHoursStatus } = useBusinessHours();
  const t = useT();
  useIdleStatus();

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [previewTicket, setPreviewTicket] = useState<Ticket | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const chatWindowRef = useRef<ChatWindowHandle>(null);

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
      // tRPC infers Drizzle row types which differ slightly from client Ticket interface
      // (e.g. participants as JSONB object vs typed array). Runtime data is compatible.
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

  const isSplitView = viewMode === 'split-grid' || viewMode === 'split-stack';

  // Auto-fallback from split-stack when fewer than 2 tabs open (grid keeps empty slots)
  useEffect(() => {
    if (viewMode === 'split-stack' && supportOpenTickets.length < 2) {
      setViewMode('normal');
    }
  }, [viewMode, supportOpenTickets.length, setViewMode]);

  // Auto-fallback from split views on narrow viewports
  useEffect(() => {
    if (isSplitView && window.innerWidth < 768) {
      setViewMode('normal');
    }
  }, [isSplitView, setViewMode]);

  // ── Actions ──

  function selectTicket(ticket: Ticket) {
    if (!user) return;
    if (supportOpenTickets.includes(ticket.id)) {
      setActiveTab(ticket.id);
      clearUnread(ticket.id);
      setPreviewTicket(null);
    } else if (!atMaxChats) {
      // In split view, join directly — TicketPreview is not rendered
      if (isSplitView) {
        joinTicket(ticket);
      } else {
        setPreviewTicket(ticket);
      }
    }
  }

  function handleSelectTicket(ticket: Ticket) {
    selectTicket(ticket);
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
    // Notify server so it unassigns the agent from the ticket
    const ticket = tickets.find((tk) => tk.id === ticketId);
    if (ticket && ticket.status !== 'closed') {
      getSocket().emit('support:leave', { ticketId });
    }
    removeSupportOpenTicket(ticketId);
    if (activeTab === ticketId) {
      const remaining = openTabTickets.filter((tk) => tk.id !== ticketId);
      setActiveTab(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  // ── Command Palette ──

  const navigateTab = useCallback((direction: 1 | -1) => {
    if (openTabTickets.length < 2 || !activeTab) return;
    const idx = openTabTickets.findIndex((tk) => tk.id === activeTab);
    const next = (idx + direction + openTabTickets.length) % openTabTickets.length;
    setActiveTab(openTabTickets[next].id);
  }, [openTabTickets, activeTab]);

  const commands: Command[] = useMemo(() => [
    // Navigation
    { id: 'focus-message', labelKey: 'cmd_focus_message', groupKey: 'cmd_group_navigation', shortcutHint: '/', execute: () => chatWindowRef.current?.focusTextarea(), keywords: ['type', 'input', 'chat'] },
    { id: 'next-tab', labelKey: 'cmd_next_tab', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+\u2193', execute: () => navigateTab(1), enabled: openTabTickets.length >= 2, keywords: ['switch', 'tab'] },
    { id: 'prev-tab', labelKey: 'cmd_prev_tab', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+\u2191', execute: () => navigateTab(-1), enabled: openTabTickets.length >= 2, keywords: ['switch', 'tab'] },
    { id: 'toggle-sidebar', labelKey: 'cmd_toggle_sidebar', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+B', execute: () => setSidebarOpen((v) => !v), keywords: ['queue', 'sidebar', 'hide', 'show'] },
    { id: 'search-tickets', labelKey: 'cmd_search_tickets', groupKey: 'cmd_group_navigation', execute: () => { setSidebarOpen(true); setTimeout(() => { const el = document.querySelector<HTMLInputElement>('[data-queue-search]'); el?.focus(); }, 50); }, keywords: ['find', 'search', 'filter'] },
    // Actions
    { id: 'toggle-whisper', labelKey: 'cmd_toggle_whisper', groupKey: 'cmd_group_actions', execute: () => chatWindowRef.current?.toggleWhisper(), enabled: !!activeTab, keywords: ['whisper', 'internal', 'private'] },
    { id: 'transfer-ticket', labelKey: 'cmd_transfer_ticket', groupKey: 'cmd_group_actions', execute: () => chatWindowRef.current?.openTransferMenu(), enabled: !!activeTab, keywords: ['transfer', 'hand off', 'department'] },
    { id: 'close-tab', labelKey: 'cmd_close_tab', groupKey: 'cmd_group_actions', execute: () => { if (activeTab) closeTab(activeTab); }, enabled: !!activeTab, keywords: ['close', 'tab'] },
    { id: 'close-ticket', labelKey: 'cmd_close_ticket', groupKey: 'cmd_group_actions', execute: () => chatWindowRef.current?.triggerCloseTicket(), enabled: !!activeTab, keywords: ['resolve', 'close', 'end'] },
    // Status
    { id: 'status-online', labelKey: 'cmd_status_online', groupKey: 'cmd_group_status', execute: () => getSocket().emit('status:set', { status: 'online' }), keywords: ['online', 'available'] },
    { id: 'status-away', labelKey: 'cmd_status_away', groupKey: 'cmd_group_status', execute: () => getSocket().emit('status:set', { status: 'away' }), keywords: ['away', 'break', 'pause'] },
    // View & Toggles
    { id: 'toggle-focus', labelKey: 'cmd_toggle_focus', groupKey: 'cmd_group_view', execute: () => { const s = useStore.getState(); s.setViewMode(s.viewMode === 'focus' ? 'normal' : 'focus'); }, keywords: ['focus', 'distraction'] },
    { id: 'toggle-dark', labelKey: 'cmd_toggle_dark', groupKey: 'cmd_group_view', execute: () => document.documentElement.classList.toggle('dark'), keywords: ['dark', 'light', 'theme'] },
    { id: 'toggle-sidebar-right', labelKey: 'cmd_toggle_sidebar_right', groupKey: 'cmd_group_view', execute: () => useStore.getState().toggleRightSidebar(), keywords: ['sidebar', 'context', 'panel', 'copilot', 'info'] },
  ], [activeTab, openTabTickets, navigateTab]);

  useKeyboardShortcuts({
    enabled: !paletteOpen,
    onOpenPalette: () => setPaletteOpen(true),
    onFocusMessage: () => chatWindowRef.current?.focusTextarea(),
    onNextTab: () => navigateTab(1),
    onPrevTab: () => navigateTab(-1),
    onToggleSidebar: () => setSidebarOpen((v) => !v),
  });

  // ── Guards ──

  if (!user) return null;
  if (!activeMembership) return <PartnerUnavailable />;

  // ── Render ──

  return (
    <ErrorBoundary>
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
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

      <SupportNav partnerName={partnerName} logoUrl={logoUrl} onToggleSidebar={() => setSidebarOpen((v) => !v)} />

      <div className="flex flex-1 overflow-hidden relative">
        {activeMembership && (
          <QueueSidebar
            activeMembership={activeMembership}
            activeTab={activeTab}
            previewTicketId={previewTicket?.id || null}
            atMaxChats={atMaxChats}
            isOpen={viewMode !== 'focus' && sidebarOpen}
            onSelectTicket={handleSelectTicket}
            onPreviewArchived={(ticket) => setPreviewTicket(ticket)}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg-base)]">
          <ChatTabBar
            tabs={openTabTickets}
            activeTab={activeTab}
            onSelectTab={(id) => setActiveTab(id)}
            onCloseTab={closeTab}
          />

          <div className="flex-1 overflow-hidden flex">
            <div className="flex-1 overflow-hidden">
              {isSplitView ? (
                <SplitChatLayout
                  tabs={openTabTickets}
                  activeTab={activeTab}
                  onSelectTab={(id) => setActiveTab(id)}
                  onCloseTab={closeTab}
                  mode={viewMode as 'split-grid' | 'split-stack'}
                />
              ) : showPreview ? (
                <TicketPreview
                  ticket={previewTicket!}
                  onJoin={() => joinTicket(previewTicket!)}
                  onClose={() => setPreviewTicket(null)}
                  joinDisabled={atMaxChats}
                />
              ) : activeTab ? (
                <ChatWindow
                  ref={chatWindowRef}
                  key={activeTab}
                  ticket={tickets.find((tk) => tk.id === activeTab)}
                  onClose={() => closeTab(activeTab)}
                />
              ) : (
                <div className="h-full flex items-center justify-center font-bold uppercase tracking-wide opacity-20 text-2xl">
                  {t('ready_to_help')}
                </div>
              )}
            </div>

            {/* Ticket context sidebar (only in normal mode) */}
            {activeTab && !showPreview && !focusMode && viewMode === 'normal' && (() => {
              const activeTicket = tickets.find((tk) => tk.id === activeTab);
              return activeTicket ? <TicketSidebar ticket={activeTicket} /> : null;
            })()}
          </div>
        </main>
      </div>

      {/* Command Palette overlay */}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
    </ErrorBoundary>
  );
}
