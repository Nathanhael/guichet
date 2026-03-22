import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ManageAccessModal from '../ManageAccessModal';
import type { GlobalUser } from '../types';

const { mockRemove, mockUpdateMembership, userWithAccess, userNoAccess } = vi.hoisted(() => {
  const userWithAccess: GlobalUser = {
    id: 'u1', name: 'Jane', email: 'jane@test.com',
    isPlatformOperator: false, deletedAt: null, lastActiveAt: null, externalId: null,
    partnerMemberships: [
      { id: 'm1', partnerId: 'p1', partnerName: 'Acme', role: 'admin' },
      { id: 'm2', partnerId: 'p2', partnerName: 'Beta Inc', role: 'support' },
    ],
  };
  const userNoAccess: GlobalUser = {
    id: 'u2', name: 'Empty User', email: 'empty@test.com',
    isPlatformOperator: false, deletedAt: null, lastActiveAt: null, externalId: null,
    partnerMemberships: [],
  };
  return {
    mockRemove: { mutate: vi.fn(), isPending: false },
    mockUpdateMembership: { mutate: vi.fn(), isPending: false },
    userWithAccess, userNoAccess,
  };
});

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: {
        listGlobalUsers: { invalidate: vi.fn(), fetch: vi.fn().mockResolvedValue([]) },
      },
    }),
    platform: {
      removeMembership: {
        useMutation: (opts: { onSuccess?: () => Promise<void> }) => {
          mockRemove.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockRemove;
        },
      },
      updateMembership: {
        useMutation: (opts: { onSuccess?: () => Promise<void> }) => {
          mockUpdateMembership.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockUpdateMembership;
        },
      },
    },
  },
}));

describe('ManageAccessModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when user is null', () => {
    const { container } = render(<ManageAccessModal user={null} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders user name and partner memberships', () => {
    render(<ManageAccessModal user={userWithAccess} onClose={onClose} />);
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Beta Inc')).toBeInTheDocument();
  });

  it('shows "no active memberships" for user without access', () => {
    render(<ManageAccessModal user={userNoAccess} onClose={onClose} />);
    expect(screen.getByText('no_active_memberships')).toBeInTheDocument();
  });

  it('renders role dropdown for each membership', () => {
    render(<ManageAccessModal user={userWithAccess} onClose={onClose} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    expect(selects[0]).toHaveValue('admin');
    expect(selects[1]).toHaveValue('support');
  });

  it('calls updateMembership when role is changed', () => {
    render(<ManageAccessModal user={userWithAccess} onClose={onClose} />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'agent' } });
    expect(mockUpdateMembership.mutate).toHaveBeenCalledWith({
      id: 'm1',
      data: { role: 'agent' },
    });
  });

  it('shows revoke confirmation dialog when revoke is clicked', () => {
    render(<ManageAccessModal user={userWithAccess} onClose={onClose} />);
    const revokeButtons = screen.getAllByText('revoke_access');
    fireEvent.click(revokeButtons[0]);
    expect(screen.getByText(/confirm_revoke_access/)).toBeInTheDocument();
  });

  it('calls onClose when done button is clicked', () => {
    render(<ManageAccessModal user={userWithAccess} onClose={onClose} />);
    fireEvent.click(screen.getByText('done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<ManageAccessModal user={userWithAccess} onClose={onClose} />);
    const backdrop = document.querySelector('.absolute.inset-0.bg-black.opacity-80');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
