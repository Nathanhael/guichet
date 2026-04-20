import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../Button';

describe('Button', () => {
  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults type="button" so it never submits parent forms', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('allows explicit type="submit" inside forms', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('renders leading and trailing slots around the label', () => {
    render(
      <Button leading={<span data-testid="lead">L</span>} trailing={<span data-testid="tail">R</span>}>
        Label
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('LLabelR');
    expect(screen.getByTestId('lead')).toBeInTheDocument();
    expect(screen.getByTestId('tail')).toBeInTheDocument();
  });

  it('applies primary tokens by default (accent bg, white text)', () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-[var(--color-accent)]');
    expect(btn.className).toContain('text-white');
  });

  it('applies danger tokens with the urgent palette', () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('text-[var(--color-urgent)]');
    expect(btn.className).toContain('border-[var(--color-urgent)]');
  });

  it('merges caller className without clobbering variant classes', () => {
    render(<Button className="self-end">Go</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('self-end');
    expect(btn.className).toContain('bg-[var(--color-accent)]');
  });
});
