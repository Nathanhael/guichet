import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandPalette from '../CommandPalette';
import type { Command } from '../../../types/command';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

// i18n: return key as-is (identity function)
vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeCommands(): Command[] {
  return [
    { id: 'focus', labelKey: 'cmd_focus_message', groupKey: 'cmd_group_navigation', shortcutHint: '/', execute: vi.fn() as unknown as () => void, keywords: ['type'] },
    { id: 'next', labelKey: 'cmd_next_tab', groupKey: 'cmd_group_navigation', shortcutHint: 'Ctrl+\u2193', execute: vi.fn() as unknown as () => void },
    { id: 'whisper', labelKey: 'cmd_toggle_whisper', groupKey: 'cmd_group_actions', execute: vi.fn() as unknown as () => void },
    { id: 'disabled-cmd', labelKey: 'cmd_disabled', groupKey: 'cmd_group_actions', execute: vi.fn() as unknown as () => void, enabled: false },
  ];
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('CommandPalette', () => {
  let onClose: () => void;
  let commands: Command[];

  beforeEach(() => {
    onClose = vi.fn();
    commands = makeCommands();
  });

  it('renders all enabled commands', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    expect(screen.getByText('cmd_focus_message')).toBeInTheDocument();
    expect(screen.getByText('cmd_next_tab')).toBeInTheDocument();
    expect(screen.getByText('cmd_toggle_whisper')).toBeInTheDocument();
    // Disabled commands should be filtered out
    expect(screen.queryByText('cmd_disabled')).not.toBeInTheDocument();
  });

  it('renders group headers', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    expect(screen.getByText('cmd_group_navigation')).toBeInTheDocument();
    expect(screen.getByText('cmd_group_actions')).toBeInTheDocument();
  });

  it('renders shortcut hints', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    expect(screen.getByText('/')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+\u2193')).toBeInTheDocument();
  });

  it('filters commands by search query', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    const input = screen.getByPlaceholderText('cmd_palette_placeholder');
    fireEvent.change(input, { target: { value: 'whisper' } });
    expect(screen.getByText('cmd_toggle_whisper')).toBeInTheDocument();
    expect(screen.queryByText('cmd_focus_message')).not.toBeInTheDocument();
    expect(screen.queryByText('cmd_next_tab')).not.toBeInTheDocument();
  });

  it('filters commands by keywords', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    const input = screen.getByPlaceholderText('cmd_palette_placeholder');
    fireEvent.change(input, { target: { value: 'type' } });
    expect(screen.getByText('cmd_focus_message')).toBeInTheDocument();
    expect(screen.queryByText('cmd_next_tab')).not.toBeInTheDocument();
  });

  it('shows no-results message when nothing matches', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    const input = screen.getByPlaceholderText('cmd_palette_placeholder');
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });
    expect(screen.getByText('cmd_no_results')).toBeInTheDocument();
  });

  it('Escape closes the palette', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Enter executes the selected command and closes', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(commands[0].execute).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ArrowDown + Enter executes second command', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(commands[1].execute).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking a command executes it and closes', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.click(screen.getByText('cmd_toggle_whisper'));
    expect(commands[2].execute).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking backdrop closes palette', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    // Backdrop is the first child div with bg-black/80
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.querySelector('.bg-black\\/80');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('auto-focuses the search input', () => {
    render(<CommandPalette commands={commands} onClose={onClose} />);
    const input = screen.getByPlaceholderText('cmd_palette_placeholder');
    expect(input).toHaveFocus();
  });
});
