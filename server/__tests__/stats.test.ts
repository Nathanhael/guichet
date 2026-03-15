import { describe, it, expect } from 'vitest';
import { computeLiveDayStats, calculatePercentile } from '../services/stats.js';
import { Ticket, Message } from '../types/index.js';

describe('calculatePercentile', () => {
    it('should return 0 for empty array', () => {
        expect(calculatePercentile([], 95)).toBe(0);
    });

    it('should return the correct percentile value', () => {
        const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        // Math.ceil(0.95 * 10) - 1 = 10 - 1 = 9
        expect(calculatePercentile(values, 95)).toBe(100);
        
        const values2 = [1, 2, 3, 4, 5];
        // Math.ceil(0.5 * 5) - 1 = 3 - 1 = 2
        expect(calculatePercentile(values2, 50)).toBe(3);
    });

    it('should handle unsorted arrays', () => {
        const values = [100, 10, 50, 20, 80];
        // Sorted: [10, 20, 50, 80, 100]
        // Math.ceil(0.95 * 5) - 1 = 5 - 1 = 4
        expect(calculatePercentile(values, 95)).toBe(100);
    });
});

describe('computeLiveDayStats', () => {
    it('should handle empty data', () => {
        const stats = computeLiveDayStats([], [], 'all');
        expect(stats.total).toBe(0);
        expect(stats.closed).toBe(0);
        expect(stats.slaResolved).toBe(0);
        expect(stats.p95ResponseMs).toBe(0);
    });

    it('should calculate counts correctly', () => {
        const tickets: Partial<Ticket>[] = [
            { id: '1', dept: 'DSC', status: 'closed', createdAt: '2024-01-01T10:00:00Z', supportJoinedAt: '2024-01-01T10:01:00Z', closedAt: '2024-01-01T10:10:00Z' },
            { id: '2', dept: 'FOT', status: 'open', createdAt: '2024-01-01T11:00:00Z' },
            { id: '3', dept: 'DSC', status: 'closed', createdAt: '2024-01-01T12:00:00Z', closedAt: '2024-01-01T12:05:00Z' } // Abandoned (supportJoinedAt is null)
        ];
        const stats = computeLiveDayStats(tickets as Ticket[], [], 'all');

        expect(stats.total).toBe(3);
        expect(stats.closed).toBe(2);
        expect(stats.abandoned).toBe(1); // Ticket 3 closed without support
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

    it('should calculate SLA metrics and p95', () => {
        const tickets: Partial<Ticket>[] = [
            { id: '1', dept: 'DSC', createdAt: '2024-01-01T10:00:00Z', supportJoinedAt: '2024-01-01T10:01:00Z' }, // 1m (60000ms) - Compliant
            { id: '2', dept: 'DSC', createdAt: '2024-01-01T11:00:00Z', supportJoinedAt: '2024-01-01T11:05:00Z' }  // 5m (300000ms) - Violates
        ];
        const stats = computeLiveDayStats(tickets as Ticket[], [], 'all');
        expect(stats.slaResolved).toBe(2);
        expect(stats.slaCompliant).toBe(1);
        expect(stats.p95ResponseMs).toBe(300000);
    });

    it('should calculate re-open rates', () => {
        const tickets: any[] = [
            { id: '1', dept: 'DSC', reopened: true },
            { id: '2', dept: 'DSC', reopened: false },
            { id: '3', dept: 'DSC' }
        ];
        const stats = computeLiveDayStats(tickets as Ticket[], [], 'all');
        expect(stats.reopened).toBe(1);
    });

    it('should aggregate sentiment scores', () => {
        const messages: any[] = [
            { id: 'm1', ticketId: '1', sentiment: 0.5 },
            { id: 'm2', ticketId: '1', sentiment: -0.1 },
            { id: 'm3', ticketId: '2', sentiment: null },
            { id: 'm4', ticketId: '2' }
        ];
        const stats = computeLiveDayStats([], [], 'all', messages as Message[]);
        expect(stats.sentimentSum).toBe(0.4);
        expect(stats.sentimentCount).toBe(2);
    });
});

