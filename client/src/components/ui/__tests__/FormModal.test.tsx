import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FormModal, { FIELD_LABEL, INPUT } from '../FormModal';
import { makeMutationMock } from '../../../test/helpers';

describe('FormModal — open / close', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <FormModal
        open={false}
        onClose={vi.fn()}
        title="X"
        mutation={makeMutationMock()}
        onSubmit={() => null}
        submitLabel="Save"
      >
        <input data-testid="field" />
      </FormModal>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title + Cancel + Save when open', () => {
    render(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="My Title"
        mutation={makeMutationMock()}
        onSubmit={() => ({ x: 1 })}
        submitLabel="Save"
      >
        <input data-testid="field" />
      </FormModal>,
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByTestId('field')).toBeInTheDocument();
  });

  it('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <FormModal open={true} onClose={onClose} title="X" mutation={makeMutationMock()} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('honors a custom cancelLabel', () => {
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={makeMutationMock()} onSubmit={() => ({})} submitLabel="Save" cancelLabel="Annuleren">
        <span />
      </FormModal>,
    );
    expect(screen.getByText('Annuleren')).toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });
});

describe('FormModal — onSubmit gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not call mutation.mutate when onSubmit returns null', () => {
    const m = makeMutationMock();
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => null} submitLabel="Save">
        <span />
      </FormModal>,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(m.mutate).not.toHaveBeenCalled();
  });

  it('calls mutation.mutate with the value when onSubmit returns non-null', () => {
    const m = makeMutationMock();
    const input = { id: 'x', name: 'y' };
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => input} submitLabel="Save">
        <span />
      </FormModal>,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(m.mutate).toHaveBeenCalledTimes(1);
    expect(m.mutate).toHaveBeenCalledWith(input);
  });
});

describe('FormModal — pending state', () => {
  it('disables submit when mutation.isPending=true', () => {
    const m = makeMutationMock({ isPending: true });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>,
    );
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('respects caller-passed disabled prop independently of pending', () => {
    const m = makeMutationMock({ isPending: false });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save" disabled>
        <span />
      </FormModal>,
    );
    expect(screen.getByText('Save')).toBeDisabled();
  });
});

describe('FormModal — success lifecycle', () => {
  it('calls invalidate then onClose then mutation.reset when isSuccess transitions true', () => {
    const onClose = vi.fn();
    const invalidate = vi.fn();
    const reset = vi.fn();
    const order: string[] = [];
    invalidate.mockImplementation(() => order.push('invalidate'));
    onClose.mockImplementation(() => order.push('onClose'));
    reset.mockImplementation(() => order.push('reset'));

    const m = makeMutationMock({ isSuccess: true });
    m.reset = reset;

    render(
      <FormModal
        open={true}
        onClose={onClose}
        title="X"
        mutation={m}
        onSubmit={() => ({})}
        submitLabel="Save"
        invalidate={invalidate}
      >
        <span />
      </FormModal>,
    );

    expect(order).toEqual(['invalidate', 'onClose', 'reset']);
  });

  it('calls onSuccessData with mutation.data BEFORE invalidate + onClose + reset', () => {
    const order: string[] = [];
    const onSuccessData = vi.fn(() => order.push('onSuccessData'));
    const invalidate = vi.fn(() => order.push('invalidate'));
    const onClose = vi.fn(() => order.push('onClose'));
    const reset = vi.fn(() => order.push('reset'));

    const m = makeMutationMock({ isSuccess: true });
    m.data = { foo: 'bar' };
    m.reset = reset;

    render(
      <FormModal
        open={true}
        onClose={onClose}
        title="X"
        mutation={m}
        onSubmit={() => ({})}
        submitLabel="Save"
        invalidate={invalidate}
        onSuccessData={onSuccessData}
      >
        <span />
      </FormModal>,
    );

    expect(order).toEqual(['onSuccessData', 'invalidate', 'onClose', 'reset']);
    expect(onSuccessData).toHaveBeenCalledWith({ foo: 'bar' });
  });

  it('does not call invalidate or onClose when isSuccess stays false', () => {
    const onClose = vi.fn();
    const invalidate = vi.fn();
    const m = makeMutationMock({ isSuccess: false });

    render(
      <FormModal open={true} onClose={onClose} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save" invalidate={invalidate}>
        <span />
      </FormModal>,
    );

    expect(invalidate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('FormModal — error toast', () => {
  it('renders Toast with error message when mutation.error is non-null', () => {
    const m = makeMutationMock({ error: { message: 'Boom' } });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>,
    );
    expect(screen.getByText('Boom')).toBeInTheDocument();
  });

  it('calls mutation.reset when the toast is dismissed', () => {
    const reset = vi.fn();
    const m = makeMutationMock({ error: { message: 'Boom' }, reset });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>,
    );
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not render Toast when mutation.error is null', () => {
    const m = makeMutationMock({ error: null });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>,
    );
    expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();
  });
});

describe('FormModal — submit variant', () => {
  it('renders the danger button styling when submitVariant="danger"', () => {
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={makeMutationMock()} onSubmit={() => ({})} submitLabel="Delete" submitVariant="danger">
        <span />
      </FormModal>,
    );
    const btn = screen.getByText('Delete');
    expect(btn.className).toMatch(/urgent/);
  });

  it('defaults to primary styling when submitVariant is omitted', () => {
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={makeMutationMock()} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>,
    );
    const btn = screen.getByText('Save');
    expect(btn.className).toMatch(/accent/);
  });
});

describe('FormModal — header customization', () => {
  it('renders headerSlot in place of title+subtitle when provided', () => {
    render(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="ignored"
        subtitle="also ignored"
        headerSlot={<div data-testid="custom-header">Custom</div>}
        mutation={makeMutationMock()}
        onSubmit={() => ({})}
        submitLabel="Save"
      >
        <span />
      </FormModal>,
    );
    expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
    expect(screen.queryByText('also ignored')).not.toBeInTheDocument();
  });
});

describe('FormModal — exported constants', () => {
  it('exports FIELD_LABEL and INPUT class strings', () => {
    expect(FIELD_LABEL).toMatch(/font-medium/);
    expect(INPUT).toMatch(/h-9/);
  });
});
