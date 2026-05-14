import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlatformSecurity from '../PlatformSecurity';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                      */
/* ------------------------------------------------------------------ */

const { mockSetMutate, mutationState, queryState } = vi.hoisted(() => ({
  mockSetMutate: vi.fn(),
  mutationState: { isPending: false },
  queryState: {
    data: { piiRedaction: 'on', auditVerbosity: 'metadata' } as unknown,
    isLoading: false,
  },
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../Toast', () => ({
  default: ({ message }: { message: string }) => <div data-testid="toast">{message}</div>,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: {
        getAiSecurityDefaults: { invalidate: vi.fn() },
      },
    }),
    platform: {
      getAiSecurityDefaults: {
        useQuery: () => ({ data: queryState.data, isLoading: queryState.isLoading }),
      },
      setAiSecurityDefaults: {
        useMutation: (opts?: { onSuccess?: () => void; onError?: (err: Error) => void }) => ({
          mutate: (...args: unknown[]) => {
            mockSetMutate(...args);
            opts?.onSuccess?.();
          },
          isPending: mutationState.isPending,
        }),
      },
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('PlatformSecurity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.data = { piiRedaction: 'on', auditVerbosity: 'metadata' };
    queryState.isLoading = false;
    mutationState.isPending = false;
  });

  it('renders both sections with the saved values pre-selected', () => {
    queryState.data = { piiRedaction: 'off', auditVerbosity: 'full' };
    render(<PlatformSecurity />);

    const piiOff = screen.getByLabelText('ai_security_pii_off') as HTMLInputElement;
    const auditFull = screen.getByLabelText('ai_security_audit_full') as HTMLInputElement;
    expect(piiOff.checked).toBe(true);
    expect(auditFull.checked).toBe(true);
  });

  it('calls setAiSecurityDefaults with piiRedaction="off" when user picks Off + Save', () => {
    render(<PlatformSecurity />);

    const piiOff = screen.getByLabelText('ai_security_pii_off');
    fireEvent.click(piiOff);
    fireEvent.click(screen.getByText('ai_security_save'));

    expect(mockSetMutate).toHaveBeenCalledTimes(1);
    expect(mockSetMutate).toHaveBeenCalledWith(
      expect.objectContaining({ piiRedaction: 'off', auditVerbosity: 'metadata' }),
    );
  });

  it('calls setAiSecurityDefaults with auditVerbosity="full" when user picks Full + Save', () => {
    render(<PlatformSecurity />);

    const auditFull = screen.getByLabelText('ai_security_audit_full');
    fireEvent.click(auditFull);
    fireEvent.click(screen.getByText('ai_security_save'));

    expect(mockSetMutate).toHaveBeenCalledWith(
      expect.objectContaining({ piiRedaction: 'on', auditVerbosity: 'full' }),
    );
  });

  it('disables the Save button while the mutation is in-flight', () => {
    mutationState.isPending = true;
    render(<PlatformSecurity />);

    // While pending the save button shows a placeholder (e.g. '…') and is disabled.
    const buttons = Array.from(document.querySelectorAll('button'));
    const saveBtn = buttons.find((b) => b.disabled);
    expect(saveBtn).toBeDefined();
    expect(saveBtn).toBeDisabled();
  });

  it('renders a loading state while the query is loading', () => {
    queryState.isLoading = true;
    queryState.data = undefined;
    render(<PlatformSecurity />);

    // Either a spinner or the literal "Loading…" placeholder used elsewhere.
    expect(screen.getByTestId('platform-security-loading')).toBeInTheDocument();
  });
});
