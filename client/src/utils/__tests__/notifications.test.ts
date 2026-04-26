/**
 * Behavior tests for the tab-title badge + focus handler.
 *
 * Four updateTitleBadge branches:
 *   1. No unreads          → "Guichet"
 *   2. Staff role          → "(N) Guichet"
 *   3. Agent + 1 sender    → "● New message from Sarah — Guichet"
 *   4. Agent + mixed       → "● 3 new messages from support — Guichet"
 *
 * Plus the focus handler invariant: dismiss only the active ticket's
 * unread, never `clearAllUnread()` (would wipe QueueSidebar/ChatTabBar
 * badges staff rely on).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const storeState: {
  unreadTickets: Record<string, number>;
  unreadSenders: Record<string, string>;
  activeTicketId: string | null;
  activeMembershipId: string | null;
  memberships: Array<{ id: string; role: string }>;
  selectedLang: string | null;
  user: { lang: string | null } | null;
  clearUnread: ReturnType<typeof vi.fn>;
  clearAllUnread: ReturnType<typeof vi.fn>;
} = {
  unreadTickets: {},
  unreadSenders: {},
  activeTicketId: null,
  activeMembershipId: null,
  memberships: [],
  selectedLang: 'en',
  user: null,
  clearUnread: vi.fn(),
  clearAllUnread: vi.fn(),
};

vi.mock('../../store/useStore', () => ({
  default: { getState: () => storeState },
}));

vi.mock('../../i18n', () => ({
  tStandalone: (key: string) => {
    const dict: Record<string, string> = {
      tab_new_message_from: 'New message from {name}',
      tab_new_messages_from_one: '{count} new messages from {name}',
      tab_new_messages_from_support: '{count} new messages from support',
    };
    return dict[key] ?? key;
  },
}));

import { updateTitleBadge, initTitleBadgeListener } from '../notifications';

function reset() {
  storeState.unreadTickets = {};
  storeState.unreadSenders = {};
  storeState.activeTicketId = null;
  storeState.activeMembershipId = null;
  storeState.memberships = [];
  storeState.clearUnread.mockReset();
  storeState.clearAllUnread.mockReset();
  document.title = '';
}

describe('updateTitleBadge', () => {
  beforeEach(reset);

  it('renders the bare base title when there are no unreads', () => {
    updateTitleBadge();
    expect(document.title).toBe('Guichet');
  });

  it('renders compact (N) Guichet for staff role (admin, support, platform)', () => {
    storeState.unreadTickets = { 't-1': 2, 't-2': 1 };
    storeState.activeMembershipId = 'm-1';
    storeState.memberships = [{ id: 'm-1', role: 'support' }];

    updateTitleBadge();
    expect(document.title).toBe('(3) Guichet');
  });

  it('renders the sender-aware title for agents with a single unread', () => {
    storeState.unreadTickets = { 't-1': 1 };
    storeState.unreadSenders = { 't-1': 'Sarah' };
    storeState.activeMembershipId = 'm-agent';
    storeState.memberships = [{ id: 'm-agent', role: 'agent' }];

    updateTitleBadge();
    expect(document.title).toBe('● New message from Sarah — Guichet');
  });

  it('renders "from support" for agents with mixed senders across tickets', () => {
    storeState.unreadTickets = { 't-1': 1, 't-2': 2 };
    storeState.unreadSenders = { 't-1': 'Sarah', 't-2': 'Mike' };
    storeState.activeMembershipId = 'm-agent';
    storeState.memberships = [{ id: 'm-agent', role: 'agent' }];

    updateTitleBadge();
    expect(document.title).toBe('● 3 new messages from support — Guichet');
  });

  it('renders the count + sender for agents with multiple unreads from one sender', () => {
    storeState.unreadTickets = { 't-1': 3 };
    storeState.unreadSenders = { 't-1': 'Sarah' };
    storeState.activeMembershipId = 'm-agent';
    storeState.memberships = [{ id: 'm-agent', role: 'agent' }];

    updateTitleBadge();
    expect(document.title).toBe('● 3 new messages from Sarah — Guichet');
  });
});

describe('initTitleBadgeListener — focus handler', () => {
  beforeEach(reset);

  it('clears only the active ticket on focus, never all unreads', () => {
    storeState.activeTicketId = 't-active';
    storeState.unreadTickets = { 't-active': 1, 't-other': 2 };

    const cleanup = initTitleBadgeListener();
    window.dispatchEvent(new Event('focus'));

    expect(storeState.clearUnread).toHaveBeenCalledWith('t-active');
    expect(storeState.clearAllUnread).not.toHaveBeenCalled();
    cleanup();
  });

  it('does not clear anything on focus when no ticket is active', () => {
    storeState.activeTicketId = null;
    storeState.unreadTickets = { 't-other': 2 };

    const cleanup = initTitleBadgeListener();
    window.dispatchEvent(new Event('focus'));

    expect(storeState.clearUnread).not.toHaveBeenCalled();
    expect(storeState.clearAllUnread).not.toHaveBeenCalled();
    cleanup();
  });

  it('removes the focus listener when the cleanup function is called', () => {
    storeState.activeTicketId = 't-active';
    storeState.unreadTickets = { 't-active': 1 };

    const cleanup = initTitleBadgeListener();
    cleanup();
    window.dispatchEvent(new Event('focus'));

    expect(storeState.clearUnread).not.toHaveBeenCalled();
  });
});
