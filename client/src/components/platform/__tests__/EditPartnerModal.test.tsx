import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditPartnerModal from '../EditPartnerModal';
import type { Partner } from '../types';

const { mockUpdate, partner } = vi.hoisted(() => ({
  mockUpdate: { mutate: vi.fn(), isPending: false },
  partner: {
    id: 'edit-1', name: 'EditCorp', logoUrl: null, industry: 'Tech',
    status: 'active', createdAt: '', updatedAt: '',
  } satisfies Partner,
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: { listPartners: { invalidate: vi.fn() } },
    }),
    platform: {
      updatePartner: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (err: Error) => void }) => {
          mockUpdate.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockUpdate;
        },
      },
    },
  },
}));

describe('EditPartnerModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when partner is null', () => {
    const { container } = render(<EditPartnerModal partner={null} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders with partner data pre-filled', () => {
    render(<EditPartnerModal partner={partner} onClose={onClose} />);
    expect(screen.getByDisplayValue('EditCorp')).toBeInTheDocument();
    expect(screen.getByText('edit-1')).toBeInTheDocument();
  });

  it('calls update mutation with edited data', () => {
    render(<EditPartnerModal partner={partner} onClose={onClose} />);
    const nameInput = screen.getByDisplayValue('EditCorp');
    fireEvent.change(nameInput, { target: { value: 'NewName' } });

    fireEvent.click(screen.getByText('save_profile'));
    expect(mockUpdate.mutate).toHaveBeenCalledWith({
      id: 'edit-1',
      data: expect.objectContaining({ name: 'NewName' }),
    });
  });

  it('shows partner id as read-only', () => {
    render(<EditPartnerModal partner={partner} onClose={onClose} />);
    const idDisplay = screen.getByText('edit-1');
    expect(idDisplay.tagName).not.toBe('INPUT');
  });

  it('calls onClose on cancel', () => {
    render(<EditPartnerModal partner={partner} onClose={onClose} />);
    fireEvent.click(screen.getByText('cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
