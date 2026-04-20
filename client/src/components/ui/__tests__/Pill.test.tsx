import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Pill from '../Pill';

describe('Pill', () => {
  it('renders children', () => {
    render(<Pill>SLA risk</Pill>);
    expect(screen.getByText('SLA risk')).toBeInTheDocument();
  });

  it('applies urgent tone tokens when tone="urgent"', () => {
    render(<Pill tone="urgent">12m over</Pill>);
    const pill = screen.getByText('12m over').closest('span');
    expect(pill?.className).toContain('bg-[var(--color-urgent-soft)]');
    expect(pill?.className).toContain('text-[var(--color-urgent)]');
  });

  it('renders a dismiss button when onRemove is provided', () => {
    const onRemove = vi.fn();
    render(
      <Pill onRemove={onRemove} removeLabel="Remove bug label">
        bug
      </Pill>,
    );
    const btn = screen.getByRole('button', { name: 'Remove bug label' });
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does not render a dismiss button without onRemove', () => {
    render(<Pill>bug</Pill>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders leading slot before the label', () => {
    render(
      <Pill leading={<span data-testid="lead">#</span>}>42</Pill>,
    );
    expect(screen.getByTestId('lead')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
