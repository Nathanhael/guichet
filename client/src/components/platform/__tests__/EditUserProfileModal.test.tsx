import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditUserProfileModal from '../EditUserProfileModal';
import type { GlobalUser } from '../types';

const { mockUpdate, user } = vi.hoisted(() => ({
  mockUpdate: { mutate: vi.fn(), isPending: false },
  user: {
    id: 'u1', name: 'Jane Doe', email: 'jane@example.com',
    isPlatformOperator: false, deletedAt: null, lastActiveAt: null,
    externalId: null, partnerMemberships: [],
  } satisfies GlobalUser,
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: { listGlobalUsers: { invalidate: vi.fn() } },
    }),
    platform: {
      updateUser: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          mockUpdate.mutate.mockImplementation(() => opts.onSuccess?.());
          return mockUpdate;
        },
      },
    },
  },
}));

describe('EditUserProfileModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when user is null', () => {
    const { container } = render(<EditUserProfileModal user={null} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders with user data pre-filled', () => {
    render(<EditUserProfileModal user={user} onClose={onClose} />);
    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
  });

  it('calls update mutation with edited data', () => {
    render(<EditUserProfileModal user={user} onClose={onClose} />);
    const nameInput = screen.getByDisplayValue('Jane Doe');
    fireEvent.change(nameInput, { target: { value: 'Jane Smith' } });

    fireEvent.click(screen.getByText('save_profile'));
    expect(mockUpdate.mutate).toHaveBeenCalledWith({
      id: 'u1',
      data: { name: 'Jane Smith', email: 'jane@example.com' },
    });
  });

  it('sends undefined email when email field is cleared', () => {
    render(<EditUserProfileModal user={user} onClose={onClose} />);
    const emailInput = screen.getByDisplayValue('jane@example.com');
    fireEvent.change(emailInput, { target: { value: '' } });

    fireEvent.click(screen.getByText('save_profile'));
    expect(mockUpdate.mutate).toHaveBeenCalledWith({
      id: 'u1',
      data: { name: 'Jane Doe', email: undefined },
    });
  });

  it('calls onClose on cancel', () => {
    render(<EditUserProfileModal user={user} onClose={onClose} />);
    fireEvent.click(screen.getByText('cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
