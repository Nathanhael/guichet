import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import StatCard from '../StatCard';

describe('StatCard component', () => {
    it('renders label and value', () => {
        render(<StatCard label="Total Tickets" value={100} color="red" />);
        expect(screen.getByText('Total Tickets')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('renders upward trend percentage correctly', () => {
        render(<StatCard label="Live Agents" value={10} prev={8} color="green" />);
        expect(screen.getByText('\u25B2 25%')).toBeInTheDocument();
    });

    it('renders downward trend percentage correctly', () => {
        render(<StatCard label="Open Tickets" value={50} prev={100} color="red" />);
        expect(screen.getByText('\u25BC 50%')).toBeInTheDocument();
    });

    it('handles invertTrend for "good" styling', () => {
        // Upward trend is "bad" for wait time
        const { container } = render(<StatCard label="Wait Time" value={120} prev={60} color="red" invertTrend={true} />);
        const trend = screen.getByText('\u25B2 100%');
        expect(trend).toHaveClass('text-rose-500'); // Red because it went up and invertTrend=true
    });

    it('renders correctly with string values (e.g. percentages)', () => {
        render(<StatCard label="CSAT" value="95%" prev="90%" color="teal" />);
        expect(screen.getByText('95%')).toBeInTheDocument();
        expect(screen.getByText('\u25B2 6%')).toBeInTheDocument(); // round((95-90)/90 * 100) = 5.55 -> 6
    });
});
