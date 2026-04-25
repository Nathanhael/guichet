import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExternalGuestGuard from './ExternalGuestGuard';

const { mockIsExternal } = vi.hoisted(() => ({ mockIsExternal: { value: false } }));

vi.mock('../hooks/useIsExternalAdmin', () => ({
  useIsExternalAdmin: () => mockIsExternal.value,
}));

vi.mock('../i18n', () => ({
  useT: () => (key: string) => {
    const dict: Record<string, string> = {
      guest_admin_disabled_tooltip: 'Not available to external guest users. Ask an internal admin to perform this action.',
      guest_admin_disabled_tooltip_short: 'Unavailable for guests',
    };
    return dict[key] ?? key;
  },
}));

describe('ExternalGuestGuard', () => {
  beforeEach(() => {
    mockIsExternal.value = false;
  });

  it('renders children unchanged when viewer is internal', () => {
    render(
      <ExternalGuestGuard>
        <button onClick={() => {}}>Delete</button>
      </ExternalGuestGuard>,
    );
    const btn = screen.getByRole('button', { name: 'Delete' });
    // No wrapper span — children rendered at top level.
    expect(btn.parentElement?.getAttribute('data-guest-disabled')).toBeNull();
  });

  it('wraps children with aria-disabled + tooltip when viewer is external', () => {
    mockIsExternal.value = true;
    render(
      <ExternalGuestGuard>
        <button>Delete</button>
      </ExternalGuestGuard>,
    );
    const wrapper = screen.getByRole('button', { name: 'Delete' }).parentElement!;
    expect(wrapper.getAttribute('data-guest-disabled')).toBe('true');
    expect(wrapper.getAttribute('aria-disabled')).toBe('true');
    expect(wrapper.getAttribute('title')).toContain('Not available');
  });

  it('uses the short tooltip when short prop is passed', () => {
    mockIsExternal.value = true;
    render(
      <ExternalGuestGuard short>
        <button>Regenerate</button>
      </ExternalGuestGuard>,
    );
    const wrapper = screen.getByRole('button', { name: 'Regenerate' }).parentElement!;
    expect(wrapper.getAttribute('title')).toBe('Unavailable for guests');
  });

  it('swallows click events before they reach child handlers', () => {
    mockIsExternal.value = true;
    const onClick = vi.fn();
    render(
      <ExternalGuestGuard>
        <button onClick={onClick}>Delete</button>
      </ExternalGuestGuard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('swallows Enter/Space keyboard activation when viewer is external', () => {
    mockIsExternal.value = true;
    const onClick = vi.fn();
    render(
      <ExternalGuestGuard>
        <button onClick={onClick}>Delete</button>
      </ExternalGuestGuard>,
    );
    const btn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets clicks through when viewer is internal', () => {
    const onClick = vi.fn();
    render(
      <ExternalGuestGuard>
        <button onClick={onClick}>Delete</button>
      </ExternalGuestGuard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('appends caller-supplied className on the wrapper', () => {
    mockIsExternal.value = true;
    render(
      <ExternalGuestGuard className="ml-2">
        <span>x</span>
      </ExternalGuestGuard>,
    );
    const wrapper = screen.getByText('x').parentElement!;
    expect(wrapper.className).toContain('ml-2');
    expect(wrapper.className).toContain('opacity-40');
  });
});
