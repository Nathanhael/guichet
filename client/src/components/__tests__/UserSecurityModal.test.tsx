import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserSecurityModal from '../UserSecurityModal';

// Mock trpc
vi.mock('../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      mfa: { getStatus: { invalidate: vi.fn() } },
      user: { getNotificationPrefs: { invalidate: vi.fn() } },
    }),
    mfa: {
      getStatus: { 
        useQuery: vi.fn(() => ({ data: { enabled: false }, isLoading: false }))
      },
      beginSetup: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      enable: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      disable: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      regenerateRecoveryCodes: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
    },
    user: {
      changePassword: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() })) },
      getNotificationPrefs: { useQuery: vi.fn(() => ({ data: {} })) },
      updateNotificationPrefs: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
    },
  },
}));

// Mock useStore
vi.mock('../../store/useStore', () => ({
  default: vi.fn((selector: any) => selector({ user: { isPlatformOperator: true } })),
}));

describe('UserSecurityModal', () => {
  it('renders correctly', () => {
    render(<UserSecurityModal onClose={vi.fn()} />);
    expect(screen.getByText('Account Security')).toBeInTheDocument();
  });
});
