import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import useStore from './useStore';

describe('useStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    const { setUser, setToken, setTickets } = useStore.getState();
    act(() => {
      setUser(null);
      setToken(null);
      setTickets([]);
    });
  });

  describe('auth', () => {
    it('sets user and token', () => {
      const user: any = { id: '1', name: 'Test Agent', role: 'agent' as const, dept: 'DSC', lang: 'nl' as const, isPlatformOperator: false };
      act(() => {
        useStore.getState().setUser(user);
        useStore.getState().setToken('jwt-token-123');
      });
      expect(useStore.getState().user).toEqual(user);
      expect(useStore.getState().token).toBe('jwt-token-123');
    });

    it('logout clears user, token, tickets, and messages', () => {
      act(() => {
        useStore.getState().setUser({ id: '1', name: 'Test', role: 'agent', dept: 'DSC', lang: 'nl', isPlatformOperator: false });
        useStore.getState().setToken('token');
        useStore.getState().setTickets([{ id: 't1', dept: 'DSC', agentId: '1', agentName: 'Test', agentLang: 'nl', status: 'open', createdAt: '2026-01-01', participants: [], labels: [] }]);
        useStore.getState().logout();
      });
      const state = useStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.tickets).toEqual([]);
      expect(state.messages).toEqual({});
    });
  });

  describe('tickets', () => {
    const ticket: any = {
      id: 't1', dept: 'DSC', agentId: 'a1', agentName: 'Agent 1',
      agentLang: 'nl', status: 'open' as const, createdAt: '2026-01-01', participants: [], labels: [],
    };

    it('adds a ticket without duplicates', () => {
      act(() => {
        useStore.getState().addTicket(ticket);
        useStore.getState().addTicket(ticket); // duplicate
      });
      expect(useStore.getState().tickets).toHaveLength(1);
    });

    it('updates a ticket by id', () => {
      act(() => {
        useStore.getState().addTicket(ticket);
        useStore.getState().updateTicket('t1', { status: 'active', supportId: 'e1' });
      });
      const updated = useStore.getState().tickets[0];
      expect(updated.status).toBe('active');
      expect(updated.supportId).toBe('e1');
    });
  });

  describe('messages', () => {
    const msg: any = {
      id: 'm1', ticketId: 't1', senderId: 'a1', senderName: 'Agent', senderRole: 'agent', senderLang: 'nl',
      originalText: 'Hello', improvedText: 'Hello', processedText: 'Hello', text: 'Hello',
      timestamp: '2026-01-01T10:00:00Z', whisper: 0, system: 0, translationSkipped: 1, fallback: 0, reactions: {},
    };

    it('sets and adds messages per ticket', () => {
      act(() => {
        useStore.getState().setMessages('t1', [msg]);
        useStore.getState().addMessage('t1', { ...msg, id: 'm2', text: 'World', originalText: 'World', processedText: 'World' });
      });
      expect(useStore.getState().messages['t1']).toHaveLength(2);
    });

    it('updates message state (optimistic update)', () => {
      act(() => {
        useStore.getState().setMessages('t1', [{ ...msg, pending: true }]);
        useStore.getState().updateMessageState('t1', 'm1', { pending: false });
      });
      expect(useStore.getState().messages['t1'][0].pending).toBe(false);
    });
  });

  describe('UI settings', () => {
    it('toggles dark mode', () => {
      const initial = useStore.getState().darkMode;
      act(() => useStore.getState().toggleDarkMode());
      expect(useStore.getState().darkMode).toBe(!initial);
    });

    it('toggles dyslexic mode', () => {
      const initial = useStore.getState().dyslexicMode;
      act(() => useStore.getState().toggleDyslexicMode());
      expect(useStore.getState().dyslexicMode).toBe(!initial);
    });

    it('toggles bionic reading', () => {
      const initial = useStore.getState().bionicReading;
      act(() => useStore.getState().toggleBionicReading());
      expect(useStore.getState().bionicReading).toBe(!initial);
    });

    it('toggles focus mode', () => {
      const initial = useStore.getState().focusMode;
      act(() => useStore.getState().toggleFocusMode());
      expect(useStore.getState().focusMode).toBe(!initial);
    });

    it('sets connection status', () => {
      act(() => useStore.getState().setConnectionStatus('disconnected'));
      expect(useStore.getState().connectionStatus).toBe('disconnected');
      act(() => useStore.getState().setConnectionStatus('reconnecting'));
      expect(useStore.getState().connectionStatus).toBe('reconnecting');
    });
  });

  describe('labels', () => {
    it('adds and removes labels globally', () => {
      const label = { id: 'l1', name: 'Bug', text: 'Bug', color: '#ff0000' };
      act(() => {
        useStore.getState().addLabelGlobally(label);
      });
      expect(useStore.getState().allLabels).toContainEqual(label);

      act(() => useStore.getState().removeLabelGlobally('l1'));
      expect(useStore.getState().allLabels.find(l => l.id === 'l1')).toBeUndefined();
    });

    it('toggles ticket labels', () => {
      const ticket = {
        id: 't1', dept: 'DSC', agentId: 'a1', agentName: 'Agent',
        agentLang: 'nl', status: 'open' as const, createdAt: '2026-01-01',
        participants: [], labels: [] as string[],
      };
      act(() => {
        useStore.getState().addTicket(ticket);
        useStore.getState().toggleTicketLabel('t1', 'l1');
      });
      expect(useStore.getState().tickets[0].labels).toContain('l1');

      act(() => useStore.getState().toggleTicketLabel('t1', 'l1'));
      expect(useStore.getState().tickets[0].labels).not.toContain('l1');
    });
  });

  describe('presence', () => {
    it('tracks typing users per ticket', () => {
      act(() => useStore.getState().setTyping('t1', 'Support A', true));
      expect(useStore.getState().typingUsers['t1']?.['Support A']).toBe(true);

      act(() => useStore.getState().setTyping('t1', 'Support A', false));
      expect(useStore.getState().typingUsers['t1']?.['Support A']).toBeUndefined();
    });

    it('sets online support users', () => {
      const support = [{ userId: 'e1', name: 'Support 1', status: 'available' as const }];
      act(() => useStore.getState().setOnlineSupportUsers(support));
      expect(useStore.getState().onlineSupportUsers).toEqual(support);
    });
  });
});
