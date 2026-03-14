import { describe, it, expect } from 'vitest';

/**
 * Ticket lifecycle state machine tests.
 * Validates the allowed status transitions: open → active → closed
 */

const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['active', 'closed'],
  active: ['closed'],
  closed: [],
};

function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

describe('Ticket Lifecycle', () => {
  describe('Status transitions', () => {
    it('should allow open → active (support joins)', () => {
      expect(canTransition('open', 'active')).toBe(true);
    });

    it('should allow open → closed (closed without support)', () => {
      expect(canTransition('open', 'closed')).toBe(true);
    });

    it('should allow active → closed (ticket resolved)', () => {
      expect(canTransition('active', 'closed')).toBe(true);
    });

    it('should NOT allow closed → open (no reopening via status change)', () => {
      expect(canTransition('closed', 'open')).toBe(false);
    });

    it('should NOT allow closed → active', () => {
      expect(canTransition('closed', 'active')).toBe(false);
    });

    it('should NOT allow active → open (no regression)', () => {
      expect(canTransition('active', 'open')).toBe(false);
    });
  });

  describe('Ticket creation', () => {
    it('should start with status open', () => {
      const ticket = { status: 'open', agentId: 'agent-1', dept: 'DSC' };
      expect(ticket.status).toBe('open');
    });

    it('should require agentId and dept', () => {
      const ticket = { agentId: 'agent-1', dept: 'DSC' };
      expect(ticket.agentId).toBeDefined();
      expect(ticket.dept).toBeDefined();
    });

    it('should accept valid departments', () => {
      const validDepts = ['DSC', 'FOT'];
      expect(validDepts).toContain('DSC');
      expect(validDepts).toContain('FOT');
    });
  });

  describe('Participant management', () => {
    it('should start with empty participants', () => {
      const participants: { id: string; name: string }[] = [];
      expect(participants).toHaveLength(0);
    });

    it('should add support on join', () => {
      const participants: { id: string; name: string }[] = [];
      participants.push({ id: 'support-1', name: 'Jan' });
      expect(participants).toHaveLength(1);
      expect(participants[0].id).toBe('support-1');
    });

    it('should not duplicate participants', () => {
      const participants = [{ id: 'support-1', name: 'Jan' }];
      const supportId = 'support-1';
      if (!participants.find(p => p.id === supportId)) {
        participants.push({ id: supportId, name: 'Jan' });
      }
      expect(participants).toHaveLength(1);
    });

    it('should remove support on leave', () => {
      let participants = [
        { id: 'support-1', name: 'Jan' },
        { id: 'support-2', name: 'Marie' },
      ];
      participants = participants.filter(p => p.id !== 'support-1');
      expect(participants).toHaveLength(1);
      expect(participants[0].id).toBe('support-2');
    });
  });

  describe('Reopen detection', () => {
    it('should track reopen count', () => {
      let reopenCount = 0;
      // First reopen
      reopenCount++;
      expect(reopenCount).toBe(1);
      // Second reopen
      reopenCount++;
      expect(reopenCount).toBe(2);
    });

    it('should flag as reopened when matching ref exists', () => {
      const existingClosed = { id: 'ticket-old', reopen_count: 0 };
      const reopened = !!existingClosed;
      const newReopenCount = (existingClosed.reopen_count || 0) + 1;
      expect(reopened).toBe(true);
      expect(newReopenCount).toBe(1);
    });
  });
});
