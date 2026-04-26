import { describe, it, expect, beforeEach, vi } from 'vitest';

// fetch is called by authSlice.logout(). Stub it so tests don't hit the network.
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));

// disconnectSocket is invoked from logout(); avoid touching the real socket
// singleton during slice tests. peekSocket() is also called by logout to emit
// support:leave for open chat tabs — default to "no live socket" so existing
// tests stay agnostic; the dedicated emit test overrides it inline.
const mockEmit = vi.fn();
const peekSocketMock = vi.fn(() => null as { connected: boolean; emit: typeof mockEmit } | null);
vi.mock('../../hooks/useSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useSocket')>();
  return {
    ...actual,
    disconnectSocket: vi.fn(),
    peekSocket: () => peekSocketMock(),
  };
});

// trpcVanilla is touched by uiSlice toggles for accessibility prefs. Only
// matters if tests call those toggles; stub defensively.
vi.mock('../../utils/trpc', () => ({
  trpcVanilla: {
    user: {
      updateAccessibilityPrefs: { mutate: vi.fn(() => Promise.resolve()) },
    },
  },
}));

import useStore from '../useStore';

const initialState = useStore.getState();

beforeEach(() => {
  // Reset to construction-time defaults between tests so each test starts
  // from a known baseline. Replace `true` makes setState merge-replace so we
  // get a clean snapshot rather than residue from previous mutations.
  useStore.setState(initialState, true);
  mockEmit.mockClear();
  peekSocketMock.mockReturnValue(null);
});

describe('slice reset registry', () => {
  describe('_resetTicketState', () => {
    it('clears all ticket-owned fields', () => {
      useStore.setState({
        tickets: [{ id: 't1' } as never],
        activeTicketId: 't1',
        unreadTickets: { t1: 3 },
        unreadSenders: { t1: 'Alice' },
        participantsOnline: { t1: true },
        supportOpenTickets: ['t1', 't2'],
        queuePosition: { position: 2, etaMins: 5 },
        topicAlerts: [{ id: 'a1' } as never],
      });

      useStore.getState()._resetTicketState();

      const s = useStore.getState();
      expect(s.tickets).toEqual([]);
      expect(s.activeTicketId).toBeNull();
      expect(s.unreadTickets).toEqual({});
      expect(s.unreadSenders).toEqual({});
      expect(s.participantsOnline).toEqual({});
      expect(s.supportOpenTickets).toEqual([]);
      expect(s.queuePosition).toBeNull();
      expect(s.topicAlerts).toEqual([]);
    });

    it('does not touch other slices', () => {
      useStore.setState({
        tickets: [{ id: 't1' } as never],
        // foreign fields owned by other slices
        messages: { t1: [{ id: 'm1' } as never] },
        appConfig: { something: true } as never,
        ratingPrompt: { ticketId: 't1' } as never,
        agentStatus: 'away',
      });

      useStore.getState()._resetTicketState();

      const s = useStore.getState();
      expect(s.messages).toEqual({ t1: [{ id: 'm1' }] });
      expect(s.appConfig).toEqual({ something: true });
      expect(s.ratingPrompt).toEqual({ ticketId: 't1' });
      expect(s.agentStatus).toBe('away');
    });
  });

  describe('_resetMessageState', () => {
    it('clears all message-owned fields', () => {
      useStore.setState({
        messages: { t1: [{ id: 'm1' } as never] },
        messageCursors: { t1: { hasMore: true, loading: false } },
        onlineSupportUsers: [{ userId: 's1', name: 'A', status: 'online' } as never],
        onlineAgentIds: ['a1'],
        typingUsers: { t1: { Alice: true } },
        lastRejection: { ticketId: 't1', localId: 'l1', code: 'spam', at: 1 },
      });

      useStore.getState()._resetMessageState();

      const s = useStore.getState();
      expect(s.messages).toEqual({});
      expect(s.messageCursors).toEqual({});
      expect(s.onlineSupportUsers).toEqual([]);
      expect(s.onlineAgentIds).toEqual([]);
      expect(s.typingUsers).toEqual({});
      expect(s.lastRejection).toBeNull();
    });

    it('does not touch ticket or config slices', () => {
      useStore.setState({
        messages: { t1: [{ id: 'm1' } as never] },
        tickets: [{ id: 't1' } as never],
        allLabels: [{ id: 'l1' } as never],
      });

      useStore.getState()._resetMessageState();

      const s = useStore.getState();
      expect(s.tickets).toEqual([{ id: 't1' }]);
      expect(s.allLabels).toEqual([{ id: 'l1' }]);
    });
  });

  describe('_resetConfigState', () => {
    it('clears all config-owned fields', () => {
      useStore.setState({
        appConfig: { partnerId: 'p1' } as never,
        businessHoursStatus: { isOpen: true } as never,
        allLabels: [{ id: 'l1' } as never],
      });

      useStore.getState()._resetConfigState();

      const s = useStore.getState();
      expect(s.appConfig).toBeNull();
      expect(s.businessHoursStatus).toBeNull();
      expect(s.allLabels).toEqual([]);
    });
  });

  describe('_resetUIState', () => {
    it('clears session-scoped fields only', () => {
      useStore.setState({
        agentStatus: 'away',
        lightboxImages: [{ url: '/x.png', name: 'x' }],
        lightboxIndex: 0,
        prefsModifiedLocally: true,
        connectionStatus: 'connected',
      });

      useStore.getState()._resetUIState();

      const s = useStore.getState();
      expect(s.agentStatus).toBe('online');
      expect(s.lightboxImages).toEqual([]);
      expect(s.lightboxIndex).toBeNull();
      expect(s.prefsModifiedLocally).toBe(false);
      expect(s.connectionStatus).toBe('disconnected');
    });

    it('preserves device preferences', () => {
      useStore.setState({
        darkMode: true,
        selectedLang: 'fr',
        notificationsEnabled: true,
        soundEnabled: false,
        dyslexicMode: true,
        bionicReading: true,
        monochromeMode: true,
        focusMode: true,
        viewMode: 'focus',
        rightSidebarExpanded: true,
        zenSettings: { autoBionic: true, notificationShield: true },
      });

      useStore.getState()._resetUIState();

      const s = useStore.getState();
      expect(s.darkMode).toBe(true);
      expect(s.selectedLang).toBe('fr');
      expect(s.notificationsEnabled).toBe(true);
      expect(s.soundEnabled).toBe(false);
      expect(s.dyslexicMode).toBe(true);
      expect(s.bionicReading).toBe(true);
      expect(s.monochromeMode).toBe(true);
      expect(s.focusMode).toBe(true);
      expect(s.viewMode).toBe('focus');
      expect(s.rightSidebarExpanded).toBe(true);
      expect(s.zenSettings).toEqual({ autoBionic: true, notificationShield: true });
    });
  });

  describe('_resetRatingState', () => {
    it('clears the rating prompt', () => {
      useStore.setState({
        ratingPrompt: { ticketId: 't1', recipientName: 'Alice' } as never,
      });

      useStore.getState()._resetRatingState();

      expect(useStore.getState().ratingPrompt).toBeNull();
    });
  });

  describe('logout orchestrator', () => {
    it('emits support:leave for each open chat tab before disconnect', async () => {
      peekSocketMock.mockReturnValue({ connected: true, emit: mockEmit });
      useStore.setState({
        user: { id: 'u1', email: 'a@b.c' } as never,
        supportOpenTickets: ['t1', 't2', 't3'],
      });

      await useStore.getState().logout();

      expect(mockEmit).toHaveBeenCalledTimes(3);
      expect(mockEmit).toHaveBeenNthCalledWith(1, 'support:leave', { ticketId: 't1' });
      expect(mockEmit).toHaveBeenNthCalledWith(2, 'support:leave', { ticketId: 't2' });
      expect(mockEmit).toHaveBeenNthCalledWith(3, 'support:leave', { ticketId: 't3' });
    });

    it('skips emit when the socket is not live', async () => {
      // peekSocket returns null when no socket has been created yet
      peekSocketMock.mockReturnValue(null);
      useStore.setState({
        user: { id: 'u1', email: 'a@b.c' } as never,
        supportOpenTickets: ['t1'],
      });

      await useStore.getState().logout();

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('skips emit when the socket exists but is disconnected', async () => {
      peekSocketMock.mockReturnValue({ connected: false, emit: mockEmit });
      useStore.setState({
        user: { id: 'u1', email: 'a@b.c' } as never,
        supportOpenTickets: ['t1'],
      });

      await useStore.getState().logout();

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('resets every partner-scoped slice and identity', async () => {
      useStore.setState({
        // identity
        user: { id: 'u1', email: 'a@b.c' } as never,
        memberships: [{ id: 'm1' } as never],
        activeMembershipId: 'm1',
        activePartnerId: 'p1',
        // partner-scoped
        tickets: [{ id: 't1' } as never],
        messages: { t1: [{ id: 'm1' } as never] },
        appConfig: { partnerId: 'p1' } as never,
        ratingPrompt: { ticketId: 't1' } as never,
        agentStatus: 'away',
        connectionStatus: 'connected',
        // device prefs
        darkMode: true,
        selectedLang: 'fr',
      });
      sessionStorage.setItem('user', '{"id":"u1"}');
      sessionStorage.setItem('memberships', '[]');
      sessionStorage.setItem('activeMembershipId', 'm1');
      sessionStorage.setItem('activePartnerId', 'p1');

      await useStore.getState().logout();

      const s = useStore.getState();
      // identity
      expect(s.user).toBeNull();
      expect(s.memberships).toEqual([]);
      expect(s.activeMembershipId).toBeNull();
      expect(s.activePartnerId).toBeNull();
      // partner-scoped
      expect(s.tickets).toEqual([]);
      expect(s.messages).toEqual({});
      expect(s.appConfig).toBeNull();
      expect(s.ratingPrompt).toBeNull();
      expect(s.agentStatus).toBe('online');
      expect(s.connectionStatus).toBe('disconnected');
      // device prefs preserved
      expect(s.darkMode).toBe(true);
      expect(s.selectedLang).toBe('fr');
      // sessionStorage cleared
      expect(sessionStorage.getItem('user')).toBeNull();
      expect(sessionStorage.getItem('memberships')).toBeNull();
      expect(sessionStorage.getItem('activeMembershipId')).toBeNull();
      expect(sessionStorage.getItem('activePartnerId')).toBeNull();
    });
  });
});
