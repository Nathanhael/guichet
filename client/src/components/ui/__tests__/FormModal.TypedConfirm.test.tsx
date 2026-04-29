import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FormModal from '../FormModal';
import { makeMutationMock } from '../../../test/helpers';

describe('FormModal.TypedConfirm — standalone', () => {
  it('renders a label and an input with the matchValue as placeholder by default', () => {
    render(
      <FormModal.TypedConfirm matchValue="DangerCorp" label="Display name" onChange={vi.fn()} />,
    );
    expect(screen.getByText('Display name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('DangerCorp')).toBeInTheDocument();
  });

  it('calls onChange on every keystroke', () => {
    const onChange = vi.fn();
    render(<FormModal.TypedConfirm matchValue="Acme" label="Name" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Acme');
    fireEvent.change(input, { target: { value: 'Acm' } });
    fireEvent.change(input, { target: { value: 'Acme' } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('Acme');
  });

  it('honors a custom placeholder when provided', () => {
    render(
      <FormModal.TypedConfirm matchValue="Acme" label="Name" onChange={vi.fn()} placeholder="type the name" />,
    );
    expect(screen.getByPlaceholderText('type the name')).toBeInTheDocument();
  });
});

describe('FormModal.TypedConfirm — composed inside FormModal', () => {
  function Wrap({ mutation }: { mutation: ReturnType<typeof makeMutationMock> }) {
    const [v, setV] = useState('');
    return (
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="Delete"
        mutation={mutation}
        onSubmit={() => (v === 'Acme' ? 'acme-id' : null)}
        submitLabel="Delete"
        submitVariant="danger"
      >
        <FormModal.TypedConfirm matchValue="Acme" label="Name" onChange={setV} />
      </FormModal>
    );
  }

  it('parent gates onSubmit based on the typed value', () => {
    const m = makeMutationMock();
    render(<Wrap mutation={m} />);
    const input = screen.getByPlaceholderText('Acme');
    const btn = screen.getByRole('button', { name: 'Delete' });

    fireEvent.click(btn);
    expect(m.mutate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Wrong' } });
    fireEvent.click(btn);
    expect(m.mutate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.click(btn);
    expect(m.mutate).toHaveBeenCalledWith('acme-id');
  });
});
