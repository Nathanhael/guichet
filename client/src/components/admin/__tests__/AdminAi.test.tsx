// Slice 10.5: AdminAi panel for partner admins to edit glossary + per-action
// custom instructions. Hydrates from partner.config.getAiCustomization,
// saves via partner.config.updateAiCustomization.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminAi from '../AdminAi';

const { mockUpdate, mockQuery, mockAiConfigQuery, mockAnonCountQuery } = vi.hoisted(() => ({
  mockUpdate: { mutate: vi.fn(), isPending: false },
  mockQuery: { data: undefined as unknown, isLoading: false } as { data: unknown; isLoading: boolean },
  mockAiConfigQuery: {
    data: {
      globalAiEnabled: true,
      messageImprovement: 'optional' as const,
      translation: true,
      voiceTranscription: false,
      cannedTranslation: false,
    } as unknown,
    isLoading: false,
  } as { data: unknown; isLoading: boolean },
  // Opt-out aggregate query — default to a non-hidden, zero-anonymized response
  // so the compliance section renders without affecting glossary/instruction tests.
  mockAnonCountQuery: {
    data: { total: 10, anonymized: 0, hidden: false, threshold: 5 } as unknown,
    isLoading: false,
  } as { data: unknown; isLoading: boolean },
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      partner: { getAiCustomization: { invalidate: vi.fn() } },
    }),
    partner: {
      getAiCustomization: {
        useQuery: () => mockQuery,
      },
      getAiConfig: {
        useQuery: () => mockAiConfigQuery,
      },
      updateAiCustomization: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (err: Error) => void }) => {
          mockUpdate.mutate.mockImplementation(() => opts?.onSuccess?.());
          return mockUpdate;
        },
      },
    },
    ai: {
      getAnonymizedCount: {
        useQuery: () => mockAnonCountQuery,
      },
    },
  },
}));

const emptyData = {
  aiTerms: { preserve: [], forbidden: [] },
  aiCustomInstructions: { improve: '', translate: '' },
};

describe('AdminAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.data = emptyData;
    mockQuery.isLoading = false;
    mockUpdate.isPending = false;
    mockAiConfigQuery.data = {
      globalAiEnabled: true,
      messageImprovement: 'optional',
      translation: true,
      voiceTranscription: false,
      cannedTranslation: false,
    };
    mockAiConfigQuery.isLoading = false;
  });

  it('renders the glossary preserve + forbidden inputs', () => {
    render(<AdminAi />);
    expect(screen.getByLabelText(/preserve/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/forbidden/i)).toBeInTheDocument();
  });

  it('renders two instruction textareas (improve / translate)', () => {
    render(<AdminAi />);
    expect(screen.getByLabelText(/improve/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/translate/i)).toBeInTheDocument();
  });

  it('hydrates from getAiCustomization with comma-joined preserve list', () => {
    mockQuery.data = {
      aiTerms: { preserve: ['FTTP', 'MVNO', 'DSL'], forbidden: ['oldname'] },
      aiCustomInstructions: { improve: 'use bullets', translate: '' },
    };
    render(<AdminAi />);
    expect(screen.getByDisplayValue('FTTP, MVNO, DSL')).toBeInTheDocument();
    expect(screen.getByDisplayValue('oldname')).toBeInTheDocument();
    expect(screen.getByDisplayValue('use bullets')).toBeInTheDocument();
  });

  it('parses comma-separated input into a string array on save', () => {
    render(<AdminAi />);
    const preserveInput = screen.getByLabelText(/preserve/i) as HTMLInputElement;
    fireEvent.change(preserveInput, { target: { value: ' FTTP , MVNO ,, DSL ' } });
    fireEvent.click(screen.getByText(/save/i));
    const call = mockUpdate.mutate.mock.calls[0][0];
    expect(call.aiTerms.preserve).toEqual(['FTTP', 'MVNO', 'DSL']);
  });

  it('drops empty entries from the parsed list (defensive against trailing commas)', () => {
    render(<AdminAi />);
    const preserveInput = screen.getByLabelText(/preserve/i) as HTMLInputElement;
    fireEvent.change(preserveInput, { target: { value: 'A,,B,' } });
    fireEvent.click(screen.getByText(/save/i));
    const call = mockUpdate.mutate.mock.calls[0][0];
    expect(call.aiTerms.preserve).toEqual(['A', 'B']);
  });

  it('submits the edited custom instructions verbatim', () => {
    render(<AdminAi />);
    const improve = screen.getByLabelText(/improve/i) as HTMLTextAreaElement;
    fireEvent.change(improve, { target: { value: 'Always use numbered lists.' } });
    fireEvent.click(screen.getByText(/save/i));
    const call = mockUpdate.mutate.mock.calls[0][0];
    expect(call.aiCustomInstructions.improve).toBe('Always use numbered lists.');
  });

  it('disables the save button while the mutation is pending', () => {
    mockUpdate.isPending = true;
    render(<AdminAi />);
    const saveBtn = screen.getByText(/save/i).closest('button')!;
    expect(saveBtn).toBeDisabled();
  });

  it('shows a loading state before the query resolves', () => {
    mockQuery.data = undefined;
    mockQuery.isLoading = true;
    render(<AdminAi />);
    // Loading message OR a hidden form — assert form fields are NOT present.
    expect(screen.queryByLabelText(/preserve/i)).not.toBeInTheDocument();
  });

  describe('disabled-state gating (aiEnabled=false)', () => {
    function setAiOff() {
      mockAiConfigQuery.data = {
        globalAiEnabled: true,
        messageImprovement: 'off',
        translation: false,
        voiceTranscription: false,
        cannedTranslation: false,
      };
    }

    it('shows the disabled pill next to the title when no AI feature is on', () => {
      setAiOff();
      render(<AdminAi />);
      expect(screen.getByText('admin_ai_disabled_pill')).toBeInTheDocument();
    });

    it('shows the disabled banner when AI is off', () => {
      setAiOff();
      render(<AdminAi />);
      expect(screen.getByText('admin_ai_disabled_banner')).toBeInTheDocument();
    });

    it('disables glossary inputs + instruction textareas + save when AI is off', () => {
      setAiOff();
      render(<AdminAi />);
      expect(screen.getByLabelText(/preserve/i)).toBeDisabled();
      expect(screen.getByLabelText(/forbidden/i)).toBeDisabled();
      expect(screen.getByLabelText(/improve/i)).toBeDisabled();
      expect(screen.getByLabelText(/translate/i)).toBeDisabled();
      expect(screen.getByText(/save/i).closest('button')).toBeDisabled();
    });

    it('preserves existing values (does NOT wipe form) when AI flips off', () => {
      mockQuery.data = {
        aiTerms: { preserve: ['BRANDX'], forbidden: [] },
        aiCustomInstructions: { improve: 'be terse', translate: '' },
      };
      setAiOff();
      render(<AdminAi />);
      expect(screen.getByDisplayValue('BRANDX')).toBeInTheDocument();
      expect(screen.getByDisplayValue('be terse')).toBeInTheDocument();
    });

    it('treats globalAiEnabled=false as effectively-off even when feature flags say on', () => {
      mockAiConfigQuery.data = {
        globalAiEnabled: false,
        messageImprovement: 'optional',
        translation: true,
        voiceTranscription: false,
        cannedTranslation: false,
      };
      render(<AdminAi />);
      expect(screen.getByText('admin_ai_disabled_pill')).toBeInTheDocument();
      expect(screen.getByLabelText(/preserve/i)).toBeDisabled();
    });

    it('does NOT show disabled state when at least one feature is on', () => {
      render(<AdminAi />);
      expect(screen.queryByText('admin_ai_disabled_pill')).not.toBeInTheDocument();
      expect(screen.queryByText('admin_ai_disabled_banner')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/preserve/i)).not.toBeDisabled();
    });
  });
});
