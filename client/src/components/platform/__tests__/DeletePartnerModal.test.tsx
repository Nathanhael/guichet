import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeletePartnerModal from '../DeletePartnerModal';
import type { Partner } from '../types';

const { mockDelete, partner } = vi.hoisted(() => ({
  mockDelete: { mutate: vi.fn(), isPending: false },
  partner: {
    id: 'del-1', name: 'DangerCorp', logoUrl: null, industry: 'Tech',
    status: 'inactive', createdAt: '', updatedAt: '',
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
      deletePartner: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          mockDelete.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockDelete;
        },
      },
    },
  },
}));

describe('DeletePartnerModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when partner is null', () => {
    const { container } = render(<DeletePartnerModal partner={null} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders confirmation prompt with partner name', () => {
    render(<DeletePartnerModal partner={partner} onClose={onClose} />);
    expect(screen.getByPlaceholderText('DangerCorp')).toBeInTheDocument();
  });

  it('disables delete button until name is typed correctly', () => {
    render(<DeletePartnerModal partner={partner} onClose={onClose} />);
    const deleteButtons = screen.getAllByText('delete_permanently');
    const deleteBtn = deleteButtons[deleteButtons.length - 1];
    expect(deleteBtn).toBeDisabled();

    const input = screen.getByPlaceholderText('DangerCorp');
    fireEvent.change(input, { target: { value: 'WrongName' } });
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'DangerCorp' } });
    expect(deleteBtn).not.toBeDisabled();
  });

  it('calls delete mutation with partner id when confirmed', () => {
    render(<DeletePartnerModal partner={partner} onClose={onClose} />);
    const input = screen.getByPlaceholderText('DangerCorp');
    fireEvent.change(input, { target: { value: 'DangerCorp' } });

    const deleteButtons = screen.getAllByText('delete_permanently');
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(mockDelete.mutate).toHaveBeenCalledWith('del-1');
  });

  it('calls onClose when cancel button is clicked', () => {
    render(<DeletePartnerModal partner={partner} onClose={onClose} />);
    fireEvent.click(screen.getByText('cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
