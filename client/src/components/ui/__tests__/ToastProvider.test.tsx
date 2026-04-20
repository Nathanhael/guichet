import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import ToastProvider, { useToast } from '../ToastProvider';

function PushButton({ toast }: { toast: Parameters<ReturnType<typeof useToast>['push']>[0] }) {
  const { push } = useToast();
  return <button onClick={() => push(toast)}>push</button>;
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes and renders a toast with title + body', () => {
    render(
      <ToastProvider>
        <PushButton toast={{ title: 'Saved', body: 'Everything is good' }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('push'));
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Everything is good')).toBeInTheDocument();
  });

  it('auto-dismisses after the ttl elapses', () => {
    render(
      <ToastProvider>
        <PushButton toast={{ title: 'Saved', ttl: 500 }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('push'));
    expect(screen.getByText('Saved')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('keeps a toast open when ttl=0', () => {
    render(
      <ToastProvider>
        <PushButton toast={{ title: 'Sticky', ttl: 0 }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('push'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Sticky')).toBeInTheDocument();
  });

  it('dismiss button removes the toast immediately', () => {
    render(
      <ToastProvider>
        <PushButton toast={{ title: 'Saved', ttl: 10_000 }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('push'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('caps the visible stack at the configured limit', () => {
    render(
      <ToastProvider limit={2}>
        <PushButton toast={{ title: 'A', ttl: 10_000 }} />
      </ToastProvider>,
    );
    const btn = screen.getByText('push');
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    // Only 2 should be visible. The title is "A" for every push, so expect 2 matches.
    expect(screen.getAllByText('A')).toHaveLength(2);
  });

  it('throws if useToast is called outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Orphan = () => {
      useToast();
      return null;
    };
    expect(() => render(<Orphan />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
