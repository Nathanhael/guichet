// Slice 7 frontend: forced-mode improve-diff modal. Verifies the action
// buttons wire to the right callbacks, thumbs feedback fires the tRPC
// submitFeedback mutation with the right shape, and that thumbs disappear
// when the server didn't write a usage-log row (usageLogId === null).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImproveDiffModal from '../ImproveDiffModal';

vi.mock('../../../i18n', () => ({ useT: () => (k: string) => k }));

const submitFeedbackMock = vi.fn();

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    ai: {
      submitFeedback: {
        useMutation: () => ({
          mutateAsync: submitFeedbackMock,
        }),
      },
    },
  },
}));

describe('ImproveDiffModal', () => {
  beforeEach(() => {
    submitFeedbackMock.mockReset();
    submitFeedbackMock.mockResolvedValue({ feedbackId: 'fb_1' });
  });

  function defaultProps(overrides?: Partial<React.ComponentProps<typeof ImproveDiffModal>>) {
    return {
      pending: {
        original: 'Hey can u look at this',
        improved: 'Hi, could you take a look at this?',
        usageLogId: 'log_abc',
      },
      onSendImproved: vi.fn(),
      onSendOriginal: vi.fn(),
      onDismiss: vi.fn(),
      ...overrides,
    };
  }

  it('renders both original and improved panes with their text', () => {
    const props = defaultProps();
    render(<ImproveDiffModal {...props} />);
    expect(screen.getByText('Hey can u look at this')).toBeInTheDocument();
    expect(screen.getByText('Hi, could you take a look at this?')).toBeInTheDocument();
  });

  it('clicking Send improved calls onSendImproved', () => {
    const props = defaultProps();
    render(<ImproveDiffModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /improve_send_improved/ }));
    expect(props.onSendImproved).toHaveBeenCalledTimes(1);
  });

  it('clicking Send original calls onSendOriginal', () => {
    const props = defaultProps();
    render(<ImproveDiffModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /improve_send_original/ }));
    expect(props.onSendOriginal).toHaveBeenCalledTimes(1);
  });

  it('clicking thumbs-up calls submitFeedback with rating=up + originalText/aiOutput', async () => {
    const props = defaultProps();
    render(<ImproveDiffModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /improve_thumbs_up_aria/ }));
    expect(submitFeedbackMock).toHaveBeenCalledWith({
      usageLogId: 'log_abc',
      rating: 'up',
      originalText: 'Hey can u look at this',
      aiOutput: 'Hi, could you take a look at this?',
    });
  });

  it('clicking thumbs-down calls submitFeedback with rating=down', () => {
    const props = defaultProps();
    render(<ImproveDiffModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /improve_thumbs_down_aria/ }));
    expect(submitFeedbackMock).toHaveBeenCalledWith(expect.objectContaining({
      usageLogId: 'log_abc',
      rating: 'down',
      originalText: 'Hey can u look at this',
      aiOutput: 'Hi, could you take a look at this?',
    }));
  });

  it('hides thumbs buttons when usageLogId is null (server log write failed)', () => {
    const props = defaultProps({
      pending: {
        original: 'Hey',
        improved: 'Hi.',
        usageLogId: null,
      },
    });
    render(<ImproveDiffModal {...props} />);
    expect(screen.queryByRole('button', { name: /improve_thumbs_up_aria/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /improve_thumbs_down_aria/ })).toBeNull();
    // The action buttons should still be there.
    expect(screen.getByRole('button', { name: /improve_send_improved/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /improve_send_original/ })).toBeInTheDocument();
  });

  it('disables both thumbs buttons after the first click', () => {
    const props = defaultProps();
    render(<ImproveDiffModal {...props} />);
    const upBtn = screen.getByRole('button', { name: /improve_thumbs_up_aria/ });
    const downBtn = screen.getByRole('button', { name: /improve_thumbs_down_aria/ });
    fireEvent.click(upBtn);
    // Both should now be disabled — single feedback per modal.
    expect(upBtn).toBeDisabled();
    expect(downBtn).toBeDisabled();
    // Second click on either is a no-op.
    fireEvent.click(downBtn);
    expect(submitFeedbackMock).toHaveBeenCalledTimes(1);
  });
});
