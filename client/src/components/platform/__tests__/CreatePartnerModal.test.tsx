import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreatePartnerModal from '../CreatePartnerModal';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: { mutate: vi.fn(), isPending: false },
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: {
        listPartners: { invalidate: vi.fn(), getData: vi.fn() },
        listGlobalUsers: { invalidate: vi.fn() },
      },
    }),
    platform: {
      createPartner: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (err: Error) => void }) => {
          mockCreate.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockCreate;
        },
      },
    },
  },
}));

describe('CreatePartnerModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not open', () => {
    const { container } = render(<CreatePartnerModal open={false} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders form fields when open', () => {
    render(<CreatePartnerModal open={true} onClose={onClose} />);
    expect(screen.getByPlaceholderText('placeholder_partner_id')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('placeholder_partner_name')).toBeInTheDocument();
  });

  it('disables submit when id or name is empty', () => {
    render(<CreatePartnerModal open={true} onClose={onClose} />);
    const submitButtons = screen.getAllByText('create_new_partner');
    const submitBtn = submitButtons[submitButtons.length - 1];
    expect(submitBtn).toBeDisabled();
  });

  it('enables submit and calls mutation when fields are filled', () => {
    render(<CreatePartnerModal open={true} onClose={onClose} />);
    const idInput = screen.getByPlaceholderText('placeholder_partner_id');
    const nameInput = screen.getByPlaceholderText('placeholder_partner_name');

    fireEvent.change(idInput, { target: { value: 'test-id' } });
    fireEvent.change(nameInput, { target: { value: 'Test Name' } });

    const submitButtons = screen.getAllByText('create_new_partner');
    const submitBtn = submitButtons[submitButtons.length - 1];
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    expect(mockCreate.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-id', name: 'Test Name' })
    );
  });

  it('sanitizes partner id to lowercase alphanumeric with dashes', () => {
    render(<CreatePartnerModal open={true} onClose={onClose} />);
    const idInput = screen.getByPlaceholderText('placeholder_partner_id');
    fireEvent.change(idInput, { target: { value: 'My Partner ID!' } });
    expect(idInput).toHaveValue('mypartnerid');
  });

  it('calls onClose when cancel button is clicked', () => {
    render(<CreatePartnerModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<CreatePartnerModal open={true} onClose={onClose} />);
    const backdrop = document.querySelector('.absolute.inset-0.bg-black\\/80');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
