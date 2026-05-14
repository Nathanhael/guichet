import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditPartnerModal from '../EditPartnerModal';
import type { Partner } from '../types';

const { mockUpdate, partner } = vi.hoisted(() => ({
  mockUpdate: { mutate: vi.fn(), isPending: false },
  partner: {
    id: 'edit-1', name: 'EditCorp', industry: 'Tech',
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
          mockUpdate.mutate.mockImplementation(() => opts?.onSuccess?.());
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

  describe('slice 10: voiceTranscription + whisperDeployment', () => {
    const aiPartner = {
      ...partner,
      aiEnabled: true,
      aiFeatures: { voiceTranscription: false },
      aiConfig: { whisperDeployment: 'whisper-prod' },
    } as unknown as Partner;

    it('renders the voice-transcription toggle when AI is enabled', () => {
      render(<EditPartnerModal partner={aiPartner} onClose={onClose} />);
      // Two labels appear once slice 10b lands: feature toggle + envelope toggle.
      expect(screen.getAllByText('Voice Transcription').length).toBeGreaterThan(0);
      expect(screen.getByLabelText(/Toggle Voice Transcription/i)).toBeInTheDocument();
    });

    it('does NOT render the voice-transcription toggle when AI is disabled', () => {
      const noAi = { ...partner, aiEnabled: false } as unknown as Partner;
      render(<EditPartnerModal partner={noAi} onClose={onClose} />);
      expect(screen.queryByText('Voice Transcription')).not.toBeInTheDocument();
    });

    it('renders the whisperDeployment input pre-filled when AI is enabled', () => {
      render(<EditPartnerModal partner={aiPartner} onClose={onClose} />);
      expect(screen.getByDisplayValue('whisper-prod')).toBeInTheDocument();
    });

    it('flips voiceTranscription on toggle and submits the change', () => {
      render(<EditPartnerModal partner={aiPartner} onClose={onClose} />);
      const toggle = screen.getByLabelText(/Toggle Voice Transcription/i);
      fireEvent.click(toggle);
      fireEvent.click(screen.getByText('save_profile'));
      expect(mockUpdate.mutate).toHaveBeenCalledWith({
        id: 'edit-1',
        data: expect.objectContaining({
          aiFeatures: expect.objectContaining({ voiceTranscription: true }),
        }),
      });
    });

    it('submits the edited whisperDeployment value', () => {
      render(<EditPartnerModal partner={aiPartner} onClose={onClose} />);
      const input = screen.getByDisplayValue('whisper-prod');
      fireEvent.change(input, { target: { value: 'whisper-eu' } });
      fireEvent.click(screen.getByText('save_profile'));
      expect(mockUpdate.mutate).toHaveBeenCalledWith({
        id: 'edit-1',
        data: expect.objectContaining({
          aiConfig: expect.objectContaining({ whisperDeployment: 'whisper-eu' }),
        }),
      });
    });

    it('does NOT include aiConfig in submission when whisperDeployment is empty (no diff)', () => {
      const blank = { ...aiPartner, aiConfig: { whisperDeployment: '' } } as unknown as Partner;
      render(<EditPartnerModal partner={blank} onClose={onClose} />);
      fireEvent.click(screen.getByText('save_profile'));
      const call = mockUpdate.mutate.mock.calls[0][0];
      // Either aiConfig is undefined OR whisperDeployment is undefined inside it.
      const cfg = (call.data as { aiConfig?: { whisperDeployment?: string } }).aiConfig;
      expect(cfg?.whisperDeployment ?? '').toBe('');
    });
  });

  describe('slice 10c: security overrides', () => {
    const securityPartner = {
      ...partner,
      aiEnabled: true,
      aiFeatures: {},
      aiFeaturesAvailable: {},
      aiPiiRedaction: 'on',
      aiAuditVerbosity: 'metadata',
    } as unknown as Partner;

    it('renders the Security Overrides section header when AI is enabled', () => {
      render(<EditPartnerModal partner={securityPartner} onClose={onClose} />);
      expect(screen.getByText(/Security Overrides/i)).toBeInTheDocument();
    });

    it('does NOT render the Security Overrides section when AI is disabled', () => {
      const noAi = { ...partner, aiEnabled: false } as unknown as Partner;
      render(<EditPartnerModal partner={noAi} onClose={onClose} />);
      expect(screen.queryByText(/Security Overrides/i)).not.toBeInTheDocument();
    });

    it('hydrates PII radio from partner.aiPiiRedaction = "on"', () => {
      render(<EditPartnerModal partner={securityPartner} onClose={onClose} />);
      const onRadio = screen.getByLabelText(/^PII: On$/i) as HTMLInputElement;
      expect(onRadio.checked).toBe(true);
    });

    it('hydrates audit radio from partner.aiAuditVerbosity = "metadata"', () => {
      render(<EditPartnerModal partner={securityPartner} onClose={onClose} />);
      const metadataRadio = screen.getByLabelText(/^Audit: Metadata$/i) as HTMLInputElement;
      expect(metadataRadio.checked).toBe(true);
    });

    it('checks both Inherit radios when partner has NULL overrides', () => {
      const nullPartner = {
        ...securityPartner,
        aiPiiRedaction: null,
        aiAuditVerbosity: null,
      } as unknown as Partner;
      render(<EditPartnerModal partner={nullPartner} onClose={onClose} />);
      const piiInherit = screen.getByLabelText(/^PII: Inherit$/i) as HTMLInputElement;
      const auditInherit = screen.getByLabelText(/^Audit: Inherit$/i) as HTMLInputElement;
      expect(piiInherit.checked).toBe(true);
      expect(auditInherit.checked).toBe(true);
    });

    it('submits aiPiiRedaction with new value when a different PII radio is selected', () => {
      render(<EditPartnerModal partner={securityPartner} onClose={onClose} />);
      const offRadio = screen.getByLabelText(/^PII: Off$/i);
      fireEvent.click(offRadio);
      fireEvent.click(screen.getByText('save_profile'));
      expect(mockUpdate.mutate).toHaveBeenCalledWith({
        id: 'edit-1',
        data: expect.objectContaining({ aiPiiRedaction: 'off' }),
      });
    });

    it('submits aiPiiRedaction: null when Inherit is selected', () => {
      render(<EditPartnerModal partner={securityPartner} onClose={onClose} />);
      const inheritRadio = screen.getByLabelText(/^PII: Inherit$/i);
      fireEvent.click(inheritRadio);
      fireEvent.click(screen.getByText('save_profile'));
      expect(mockUpdate.mutate).toHaveBeenCalledWith({
        id: 'edit-1',
        data: expect.objectContaining({ aiPiiRedaction: null }),
      });
    });

    it('submits aiAuditVerbosity with new value when a different audit radio is selected', () => {
      render(<EditPartnerModal partner={securityPartner} onClose={onClose} />);
      const fullRadio = screen.getByLabelText(/^Audit: Full$/i);
      fireEvent.click(fullRadio);
      fireEvent.click(screen.getByText('save_profile'));
      expect(mockUpdate.mutate).toHaveBeenCalledWith({
        id: 'edit-1',
        data: expect.objectContaining({ aiAuditVerbosity: 'full' }),
      });
    });
  });
});
