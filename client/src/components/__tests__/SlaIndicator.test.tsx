import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SlaIndicator from '../SlaIndicator';

vi.mock('../../utils/trpc', () => ({
  trpc: {
    sla: {
      getTicketState: {
        useQuery: vi.fn(),
      },
    },
  },
}));

import { trpc } from '../../utils/trpc';

describe('SlaIndicator', () => {
  it('renders nothing when status is disabled', () => {
    (trpc.sla.getTicketState.useQuery as any).mockReturnValue({ data: { status: 'disabled' } });
    const { container } = render(<SlaIndicator ticketId="t1" hidden={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Met" pill for met status', () => {
    (trpc.sla.getTicketState.useQuery as any).mockReturnValue({ data: { status: 'met', respondedInMinutes: 12 } });
    render(<SlaIndicator ticketId="t1" hidden={false} />);
    expect(screen.getByText(/met/i)).toBeInTheDocument();
  });

  it('renders "X m left" for ok/warning, breached for breached', () => {
    (trpc.sla.getTicketState.useQuery as any).mockReturnValue({ data: { status: 'warning', elapsedMinutes: 25, remainingMinutes: 5 } });
    render(<SlaIndicator ticketId="t1" hidden={false} />);
    expect(screen.getByText(/5m left/i)).toBeInTheDocument();

    (trpc.sla.getTicketState.useQuery as any).mockReturnValue({ data: { status: 'breached', overdueMinutes: 7 } });
    render(<SlaIndicator ticketId="t2" hidden={false} />);
    expect(screen.getByText(/7m over/i)).toBeInTheDocument();
  });

  it('renders nothing when hidden is true', () => {
    (trpc.sla.getTicketState.useQuery as any).mockReturnValue({ data: { status: 'breached', overdueMinutes: 7 } });
    const { container } = render(<SlaIndicator ticketId="t1" hidden={true} />);
    expect(container.firstChild).toBeNull();
  });
});
