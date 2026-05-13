import { useCallback, useMemo, type RefObject } from 'react';
import useStore from '../store/useStore';
import { getSocket } from './useSocket';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { Command, ChatWindowHandle } from '../types/command';
import type { Ticket } from '../types';

type UseSupportCommandsOptions = {
  activeTab: string | null;
  setActiveTab: (id: string | null) => void;
  openTabTickets: Ticket[];
  closeTab: (id: string) => void;
  chatWindowRef: RefObject<ChatWindowHandle | null>;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  paletteOpen: boolean;
  onOpenPalette: () => void;
};

type UseSupportCommandsApi = {
  commands: Command[];
  selectTab: (id: string) => void;
};

// Owns the command-palette command list and the global keyboard-shortcut
// wiring for the support workspace. Keeps the two in sync — every command
// the palette exposes also wires through `useKeyboardShortcuts` so the
// shortcut hint shown in the palette is the same key that triggers the
// command outside the palette.
//
// The palette + shortcuts are the orchestration surface for the chat
// window (focus, transfer, close, whisper, etc.) and the support workspace
// state (sidebar, view mode, status). Both share `chatWindowRef` for
// imperative ChatWindow calls and the store for global state writes.
export function useSupportCommands({
  activeTab,
  setActiveTab,
  openTabTickets,
  closeTab,
  chatWindowRef,
  toggleSidebar,
  setSidebarOpen,
  paletteOpen,
  onOpenPalette,
}: UseSupportCommandsOptions): UseSupportCommandsApi {
  // After switching tabs via keyboard, ChatWindow remounts (keyed on
  // activeTab). Defer the focus call so the new ComposeArea is in the DOM
  // and chatWindowRef points at the fresh instance.
  const focusComposeAfterTabSwitch = useCallback(() => {
    requestAnimationFrame(() => {
      chatWindowRef.current?.focusTextarea();
    });
  }, [chatWindowRef]);

  const navigateTab = useCallback(
    (direction: 1 | -1) => {
      if (openTabTickets.length < 2 || !activeTab) return;
      const idx = openTabTickets.findIndex((tk) => tk.id === activeTab);
      const next = (idx + direction + openTabTickets.length) % openTabTickets.length;
      setActiveTab(openTabTickets[next].id);
      focusComposeAfterTabSwitch();
    },
    [openTabTickets, activeTab, setActiveTab, focusComposeAfterTabSwitch],
  );

  const jumpToTab = useCallback(
    (n: number) => {
      const idx = n - 1;
      if (idx < 0 || idx >= openTabTickets.length) return;
      setActiveTab(openTabTickets[idx].id);
      focusComposeAfterTabSwitch();
    },
    [openTabTickets, setActiveTab, focusComposeAfterTabSwitch],
  );

  // Tab-bar + split-view click: activate the chat AND land the caret in its
  // compose bar so the user can type immediately. Skip refocus if it's
  // already the active tab (preserves any in-place input focus).
  const selectTab = useCallback(
    (id: string) => {
      if (id === activeTab) return;
      setActiveTab(id);
      focusComposeAfterTabSwitch();
    },
    [activeTab, setActiveTab, focusComposeAfterTabSwitch],
  );

  const commands: Command[] = useMemo(
    () => [
      // Navigation
      { id: 'focus-message', labelKey: 'cmd_focus_message', groupKey: 'cmd_group_navigation', shortcutHint: '/', execute: () => chatWindowRef.current?.focusTextarea(), keywords: ['type', 'input', 'chat'] },
      { id: 'next-tab', labelKey: 'cmd_next_tab', groupKey: 'cmd_group_navigation', shortcutHint: 'Alt+↓', execute: () => navigateTab(1), enabled: openTabTickets.length >= 2, keywords: ['switch', 'tab'] },
      { id: 'prev-tab', labelKey: 'cmd_prev_tab', groupKey: 'cmd_group_navigation', shortcutHint: 'Alt+↑', execute: () => navigateTab(-1), enabled: openTabTickets.length >= 2, keywords: ['switch', 'tab'] },
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
    ],
    [activeTab, openTabTickets, navigateTab, jumpToTab, closeTab, toggleSidebar, chatWindowRef, setSidebarOpen],
  );

  useKeyboardShortcuts({
    enabled: !paletteOpen,
    onOpenPalette,
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
    onToggleMic: () => {
      if (activeTab) chatWindowRef.current?.toggleMic();
    },
  });

  return { commands, selectTab };
}
