import { describe, it, expect } from 'vitest';
import { computeLiveDayStats } from '../app.js';
import { Ticket } from '../types/index.js';

describe('computeLiveDayStats', () => {
    it('should handle empty data', () => {
        const stats = computeLiveDayStats([], [], 'all');
        expect(stats.total).toBe(0);
        expect(stats.closed).toBe(0);
        expect(stats.slaResolved).toBe(0);
    });

    it('should calculate counts correctly', () => {
        const tickets: Partial<Ticket>[] = [
            { id: '1', dept: 'DSC', status: 'closed', createdAt: '2024-01-01T10:00:00Z', expertJoinedAt: '2024-01-01T10:01:00Z', closedAt: '2024-01-01T10:10:00Z' },
            { id: '2', dept: 'FOT', status: 'open', createdAt: '2024-01-01T11:00:00Z' },
            { id: '3', dept: 'DSC', status: 'closed', createdAt: '2024-01-01T12:00:00Z', closedAt: '2024-01-01T12:05:00Z' } // Abandoned (expertJoinedAt is null)
        ];
        const stats = computeLiveDayStats(tickets as Ticket[], [], 'all');

        expect(stats.total).toBe(3);
        expect(stats.closed).toBe(2);
        expect(stats.abandoned).toBe(1); // Ticket 3 closed without expert
        expect(stats.deptCounts['DSC']).toBe(2);
        expect(stats.deptCounts['FOT']).toBe(1);
    });

    it('should handle department filtering', () => {
        const tickets: Partial<Ticket>[] = [
            { id: '1', dept: 'DSC', status: 'closed', createdAt: '2024-01-01T10:00:00Z' },
            { id: '2', dept: 'FOT', status: 'open', createdAt: '2024-01-01T11:00:00Z' }
        ];
        const stats = computeLiveDayStats(tickets as Ticket[], [], 'DSC');
        expect(stats.total).toBe(1);
        expect(stats.deptCounts['DSC']).toBe(1);
        expect(stats.deptCounts['FOT']).toBeUndefined();
    });

    it('should calculate SLA metrics', () => {
        const tickets: Partial<Ticket>[] = [
            { id: '1', dept: 'DSC', createdAt: '2024-01-01T10:00:00Z', expertJoinedAt: '2024-01-01T10:01:00Z' }, // Compliant (1m)
            { id: '2', dept: 'DSC', createdAt: '2024-01-01T11:00:00Z', expertJoinedAt: '2024-01-01T11:05:00Z' }  // Violates (5m)
        ];
        const stats = computeLiveDayStats(tickets as Ticket[], [], 'all');
        expect(stats.slaResolved).toBe(2);
        expect(stats.slaCompliant).toBe(1);
    });
});
