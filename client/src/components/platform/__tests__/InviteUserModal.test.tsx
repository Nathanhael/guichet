import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InviteUserModal from '../InviteUserModal';
import type { Partner } from '../types';

const { mockInvite, partner } = vi.hoisted(() => ({
  mockInvite: { mutate: vi.fn(), isPending: false },
  partner: {
    id: 'p1', name: 'Acme', logoUrl: null, industry: 'Tech',
    status: 'active', createdAt: '', updatedAt: '',
  } satisfies Partner,
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: {
        listPartners: { invalidate: vi.fn(), getData: vi.fn().mockReturnValue([partner]) },
        listGlobalUsers: { invalidate: vi.fn() },
      },
    }),
    platform: {
      listPartners: {
        useQuery: () => ({ data: [partner], isLoading: false }),
      },
      inviteUser: {
        useMutation: (opts: { onSuccess?: (data: { tempPassword: string | null; isExistingUser: boolean }) => void; onError?: (err: Error) => void }) => {
          mockInvite.mutate.mockImplementation(() =>
            opts.onSuccess?.({ tempPassword: 'abc123', isExistingUser: false })
          );
          return mockInvite;
        },
      },
    },
  },
}));

describe('InviteUserModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not open', () => {
    const { container } = render(<InviteUserModal open={false} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders invite form when open', () => {
    render(<InviteUserModal open={true} onClose={onClose} />);
    // Title heading + submit button both say "invite_new_user"
    expect(screen.getAllByText('invite_new_user').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('col_name')).toBeInTheDocument();
    expect(screen.getByText('email_label')).toBeInTheDocument();
  });

  it('disables submit when required fields are empty', () => {
    render(<InviteUserModal open={true} onClose={onClose} />);
    const submitButtons = screen.getAllByText('invite_new_user');
    const submitBtn = submitButtons[submitButtons.length - 1];
    expect(submitBtn).toBeDisabled();
  });

  it('enables submit when all required fields are filled', () => {
    render(<InviteUserModal open={true} onClose={onClose} />);

    const nameLabel = screen.getByText('col_name');
    const nameInput = nameLabel.parentElement!.querySelector('input')!;
    fireEvent.change(nameInput, { target: { value: 'John' } });

    const emailLabel = screen.getByText('email_label');
    const emailInput = emailLabel.parentElement!.querySelector('input')!;
    fireEvent.change(emailInput, { target: { value: 'john@test.com' } });

    const partnerLabel = screen.getByText('assign_partner');
    const partnerSelect = partnerLabel.parentElement!.querySelector('select')!;
    fireEvent.change(partnerSelect, { target: { value: 'p1' } });

    const submitButtons = screen.getAllByText('invite_new_user');
    const submitBtn = submitButtons[submitButtons.length - 1];
    expect(submitBtn).not.toBeDisabled();
  });

  it('shows email validation hint for invalid email', () => {
    render(<InviteUserModal open={true} onClose={onClose} />);
    const emailLabel = screen.getByText('email_label');
    const emailInput = emailLabel.parentElement!.querySelector('input')!;
    fireEvent.change(emailInput, { target: { value: 'notanemail' } });
    expect(screen.getByText('placeholder_email')).toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', () => {
    render(<InviteUserModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders partner options in the dropdown', () => {
    render(<InviteUserModal open={true} onClose={onClose} />);
    const partnerLabel = screen.getByText('assign_partner');
    const partnerSelect = partnerLabel.parentElement!.querySelector('select')!;
    const options = partnerSelect.querySelectorAll('option');
    expect(options.length).toBe(2);
    expect(options[1].textContent).toBe('Acme');
  });
});
