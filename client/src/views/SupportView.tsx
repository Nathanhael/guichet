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
import UserMenuChip from '../components/ui/UserMenuChip';
import QueueSidebar from '../components/support/QueueSidebar';
import ChatTabBar from '../components/support/ChatTabBar';
import TicketSidebar from '../components/support/TicketSidebar';
import ResizablePanel from '../components/ResizablePanel';
import SplitChatLayout from '../components/support/SplitChatLayout';
import { requestNotificationPermission } from '../utils/notifications';
import { formatBusinessHoursTimestamp, getBusinessHoursReason } from '../utils/businessHours';
import { Ticket } from '../types';
import type { Command, ChatWindowHandle } from '../types/command';
import { trpc } from '../utils/trpc';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import CommandPalette from '../components/support/CommandPalette';
import KeyboardShortcutsModal from '../components/support/KeyboardShortcutsModal';
import { useIdleStatus } from '../hooks/useIdleStatus';
import { Clock } from 'lucide-react';

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

  // Hydrate persisted tabs from localStorage (partner-scoped)
  const tabStorageKey = activeMembershipId ? `guichet:supportOpenTabs:${activeMembershipId}` : null;
  const activeTabKey = activeMembershipId ? `guichet:activeTab:${activeMembershipId}` : null;

  useEffect(() => {
    if (!tabStorageKey) return;
    try {
      const saved = localStorage.getItem(tabStorageKey);
      if (saved) {
        const ids = JSON.parse(saved) as string[];
        for (const id of ids) addSupportOpenTicket(id);
      }
    } catch { /* corrupt */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabStorageKey]);

  const [activeTab, setActiveTabRaw] = useState<string | null>(() => {
    if (!activeTabKey) return null;
    const saved = localStorage.getItem(activeTabKey);
    return saved || null;
  });
  const setActiveTab = useCallback((id: string | null) => {
    setActiveTabRaw(id);
    if (activeTabKey) {
      if (id) localStorage.setItem(activeTabKey, id);
      else localStorage.removeItem(activeTabKey);
    }
  }, [activeTabKey]);
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

  // tRPC ticket list (poll every 30s)
  const ticketsQuery = trpc.ticket.list.useQuery({}, { refetchInterval: 30000 });

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

  // Tab restore + silent rejoin — runs once per session after tickets load.
  // Merges two sources of truth:
  //   1. localStorage tabs (fast same-browser restore)
  //   2. Server-owned tickets where supportId === me and status !== closed
  //      (handles crash / logout / new-device where localStorage is empty)
  // Emits support:rejoin to reattach to ticket rooms silently (no "joined"
  // whispers). Rejects are pruned from the tab list via support:rejoin:denied.
  // Caps total tabs at MAX_OPEN_CHATS — overflow stays visible under OTHER
  // AGENTS in the queue until the user closes a tab to pick them up.
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current) return;
    if (!ticketsQuery.isSuccess || !user?.id) return;
    hasRestoredRef.current = true;
    const socket = getSocket();
    if (!socket) return;

    const onDenied = ({ ticketId }: { ticketId: string }) => {
      removeSupportOpenTicket(ticketId);
    };
    socket.on('support:rejoin:denied', onDenied);

    const validTicketIds = new Set(tickets.map((tk) => tk.id));
    const rejoined = new Set<string>();

    for (const ticketId of supportOpenTickets) {
      if (validTicketIds.has(ticketId)) {
        socket.emit('support:rejoin', { ticketId });
        rejoined.add(ticketId);
      } else {
        removeSupportOpenTicket(ticketId);
      }
    }

    const owned = tickets
      .filter((tk) => tk.supportId === user.id && tk.status !== 'closed' && !rejoined.has(tk.id))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const available = Math.max(0, MAX_OPEN_CHATS - rejoined.size);

    for (const tk of owned.slice(0, available)) {
      addSupportOpenTicket(tk.id);
      socket.emit('support:rejoin', { ticketId: tk.id });
    }

    return () => { socket.off('support:rejoin:denied', onDenied); };
  }, [ticketsQuery.isSuccess, user?.id, tickets, supportOpenTickets, addSupportOpenTicket, removeSupportOpenTicket]);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // ── Command Palette ──

  // After switching tabs via keyboard, ChatWindow remounts (keyed on
  // activeTab). Defer the focus call so the new ComposeArea is in the DOM
  // and chatWindowRef points at the fresh instance.
  const focusComposeAfterTabSwitch = useCallback(() => {
    requestAnimationFrame(() => {
      chatWindowRef.current?.focusTextarea();
    });
  }, []);

  const navigateTab = useCallback((direction: 1 | -1) => {
    if (openTabTickets.length < 2 || !activeTab) return;
    const idx = openTabTickets.findIndex((tk) => tk.id === activeTab);
    const next = (idx + direction + openTabTickets.length) % openTabTickets.length;
    setActiveTab(openTabTickets[next].id);
    focusComposeAfterTabSwitch();
  }, [openTabTickets, activeTab, setActiveTab, focusComposeAfterTabSwitch]);

  const jumpToTab = useCallback((n: number) => {
    const idx = n - 1;
    if (idx < 0 || idx >= openTabTickets.length) return;
    setActiveTab(openTabTickets[idx].id);
    focusComposeAfterTabSwitch();
  }, [openTabTickets, setActiveTab, focusComposeAfterTabSwitch]);

  // Tab-bar + split-view click: activate the chat AND land the caret in its
  // compose bar so the user can type immediately. Skip refocus if it's
  // already the active tab (preserves any in-place input focus).
  const selectTab = useCallback((id: string) => {
    if (id === activeTab) return;
    setActiveTab(id);
    focusComposeAfterTabSwitch();
  }, [activeTab, setActiveTab, focusComposeAfterTabSwitch]);

  const commands: Command[] = useMemo(() => [
    // Navigation
    { id: 'focus-message', labelKey: 'cmd_focus_message', groupKey: 'cmd_group_navigation', shortcutHint: '/', execute: () => chatWindowRef.current?.focusTextarea(), keywords: ['type', 'input', 'chat'] },
    { id: 'next-tab', labelKey: 'cmd_next_tab', groupKey: 'cmd_group_navigation', shortcutHint: 'Alt+\u2193', execute: () => navigateTab(1), enabled: openTabTickets.length >= 2, keywords: ['switch', 'tab'] },
    { id: 'prev-tab', labelKey: 'cmd_prev_tab', groupKey: 'cmd_group_navigation', shortcutHint: 'Alt+\u2191', execute: () => navigateTab(-1), enabled: openTabTickets.length >= 2, keywords: ['switch', 'tab'] },
    { id: 'toggle-sidebar', labelKey: 'cmd_toggle_sidebar', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+B', execute: toggleSidebar, keywords: ['queue', 'sidebar', 'hide', 'show'] },
    { id: 'search-tickets', labelKey: 'cmd_search_tickets', groupKey: 'cmd_group_navigation', execute: () => { setSidebarOpen(true); localStorage.setItem('queueSidebarOpen', 'true'); setTimeout(() => { const el = document.querySelector<HTMLInputElement>('[data-queue-search]'); el?.focus(); }, 50); }, keywords: ['find', 'search', 'filter'] },
    { id: 'jump-to-tab-1', labelKey: 'cmd_jump_to_tab_1', groupKey: 'cmd_group_navigation', shortcutHint: 'Alt+1', execute: () => jumpToTab(1), enabled: openTabTickets.length >= 1, keywords: ['tab', '1'] },
    { id: 'jump-to-tab-2', labelKey: 'cmd_jump_to_tab_2', groupKey: 'cmd_group_navigation', shortcutHint: 'Alt+2', execute: () => jumpToTab(2), enabled: openTabTickets.length >= 2, keywords: ['tab', '2'] },
    { id: 'jump-to-tab-3', labelKey: 'cmd_jump_to_tab_3', groupKey: 'cmd_group_navigation', shortcutHint: 'Alt+3', execute: () => jumpToTab(3), enabled: openTabTickets.length >= 3, keywords: ['tab', '3'] },
    { id: 'jump-to-tab-4', labelKey: 'cmd_jump_to_tab_4', groupKey: 'cmd_group_navigation', shortcutHint: 'Alt+4', execute: () => jumpToTab(4), enabled: openTabTickets.length >= 4, keywords: ['tab', '4'] },
    { id: 'search-messages', labelKey: 'cmd_search_messages', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+F', execute: () => window.dispatchEvent(new CustomEvent('support:open-search')), enabled: !!activeTab, keywords: ['find', 'search', 'messages'] },
    // Actions
    { id: 'toggle-whisper', labelKey: 'cmd_toggle_whisper', groupKey: 'cmd_group_actions', shortcutHint: 'Ctrl+/', execute: () => chatWindowRef.current?.toggleWhisper(), enabled: !!activeTab, keywords: ['whisper', 'internal', 'private'] },
    { id: 'transfer-ticket', labelKey: 'cmd_transfer_ticket', groupKey: 'cmd_group_actions', shortcutHint: 'Alt+T', execute: () => chatWindowRef.current?.openTransferMenu(), enabled: !!activeTab, keywords: ['transfer', 'hand off', 'department'] },
    { id: 'close-tab', labelKey: 'cmd_close_tab', groupKey: 'cmd_group_actions', shortcutHint: 'Alt+W', execute: () => { if (activeTab) closeTab(activeTab); }, enabled: !!activeTab, keywords: ['close', 'tab'] },
    { id: 'close-ticket', labelKey: 'cmd_close_ticket', groupKey: 'cmd_group_actions', shortcutHint: 'Ctrl+Enter', execute: () => chatWindowRef.current?.triggerCloseTicket(), enabled: !!activeTab, keywords: ['resolve', 'close', 'end'] },
    { id: 'open-label-picker', labelKey: 'cmd_open_label_picker', groupKey: 'cmd_group_actions', shortcutHint: 'Alt+L', execute: () => window.dispatchEvent(new CustomEvent('support:open-label-picker')), enabled: !!activeTab, keywords: ['label', 'tag'] },
    { id: 'open-canned', labelKey: 'cmd_open_canned', groupKey: 'cmd_group_actions', shortcutHint: 'Alt+J', execute: () => window.dispatchEvent(new CustomEvent('support:open-canned-picker')), enabled: !!activeTab, keywords: ['canned', 'snippet', 'template'] },
    // Status
    { id: 'status-online', labelKey: 'cmd_status_online', groupKey: 'cmd_group_status', execute: () => getSocket()?.emit('status:set', { status: 'online' }), keywords: ['online', 'available'] },
    { id: 'status-away', labelKey: 'cmd_status_away', groupKey: 'cmd_group_status', execute: () => getSocket()?.emit('status:set', { status: 'away' }), keywords: ['away', 'break', 'pause'] },
    { id: 'open-status-picker', labelKey: 'cmd_open_status_picker', groupKey: 'cmd_group_status', shortcutHint: 'Ctrl+.', execute: () => window.dispatchEvent(new CustomEvent('support:open-status-picker')), keywords: ['status', 'picker'] },
    // View & Toggles
    { id: 'toggle-focus', labelKey: 'cmd_toggle_focus', groupKey: 'cmd_group_view', shortcutHint: 'Ctrl+Shift+F', execute: () => { const s = useStore.getState(); s.setViewMode(s.viewMode === 'focus' ? 'normal' : 'focus'); }, keywords: ['focus', 'distraction'] },
    { id: 'toggle-dark', labelKey: 'cmd_toggle_dark', groupKey: 'cmd_group_view', execute: () => document.documentElement.classList.toggle('dark'), keywords: ['dark', 'light', 'theme'] },
    { id: 'toggle-sidebar-right', labelKey: 'cmd_toggle_customer_info', groupKey: 'cmd_group_view', shortcutHint: 'Ctrl+Shift+C', execute: () => useStore.getState().toggleRightSidebar(), keywords: ['sidebar', 'context', 'panel', 'info', 'customer'] },
  ], [activeTab, openTabTickets, navigateTab, jumpToTab, closeTab, toggleSidebar]);

  useKeyboardShortcuts({
    enabled: !paletteOpen,
    onOpenPalette: () => setPaletteOpen(true),
    onFocusMessage: () => chatWindowRef.current?.focusTextarea(),
    onNextTab: () => navigateTab(1),
    onPrevTab: () => navigateTab(-1),
    onToggleSidebar: toggleSidebar,
    onCloseTicket: () => {
      if (activeTab) chatWindowRef.current?.triggerCloseTicket();
    },
    onTransferTicket: () => {
      if (activeTab) chatWindowRef.current?.openTransferMenu();
    },
    onCloseTab: () => {
      if (activeTab) closeTab(activeTab);
    },
    onToggleWhisper: () => {
      if (activeTab) chatWindowRef.current?.toggleWhisper();
    },
    onExitFocus: () => {
      const s = useStore.getState();
      if (s.viewMode === 'focus') s.setViewMode('normal');
    },
    onJumpToTab: (n: number) => jumpToTab(n),
    onOpenSearch: () => {
      if (activeTab) window.dispatchEvent(new CustomEvent('support:open-search'));
    },
    onOpenLabelPicker: () => {
      if (activeTab) window.dispatchEvent(new CustomEvent('support:open-label-picker'));
    },
    onOpenCannedPicker: () => {
      if (activeTab) window.dispatchEvent(new CustomEvent('support:open-canned-picker'));
    },
    onToggleAiCopilot: () => {
      useStore.getState().toggleRightSidebar();
    },
    onOpenStatusPicker: () => {
      window.dispatchEvent(new CustomEvent('support:open-status-picker'));
    },
    onToggleFocus: () => {
      const s = useStore.getState();
      s.setViewMode(s.viewMode === 'focus' ? 'normal' : 'focus');
    },
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
              <div className="px-2 pt-3 pb-2 border-b border-[var(--color-border)] flex-shrink-0">
                <UserMenuChip
                  showStatus
                  showKeyboardShortcuts
                  showFocusMode
                  onKeyboardShortcuts={() => setShortcutsOpen(true)}
                  confirmBeforeSwitch
                />
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                <QueueSidebar
                  activeMembership={activeMembership}
                  activeTab={activeTab}
                  previewTicketId={previewTicket?.id || null}
                  atMaxChats={atMaxChats}
                  onToggle={toggleSidebar}
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
                collapsedLabel={t('ticket_context') || 'CONTEXT'}
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
