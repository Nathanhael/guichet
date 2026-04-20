import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccessibilityMenu from '../AccessibilityMenu';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockStore = {
  dyslexicMode: false,
  bionicReading: false,
  monochromeMode: false,
  focusMode: false,
  toggleDyslexicMode: vi.fn(),
  toggleBionicReading: vi.fn(),
  toggleMonochromeMode: vi.fn(),
  toggleFocusMode: vi.fn(),
};

vi.mock('../../store/useStore', () => {
  const store = (selector?: (s: typeof mockStore) => unknown) => selector ? selector(mockStore) : mockStore;
  store.getState = () => mockStore;
  return { default: store, useStoreShallow: (selector: (s: typeof mockStore) => unknown) => selector(mockStore) };
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('AccessibilityMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.dyslexicMode = false;
    mockStore.bionicReading = false;
    mockStore.monochromeMode = false;
    mockStore.focusMode = false;
  });

  it('renders trigger button with accessibility title', () => {
    render(<AccessibilityMenu />);
    expect(screen.getByTitle('Accessibility options')).toBeInTheDocument();
  });

  it('opens popover on click — shows all 4 toggle labels', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility options'));
    expect(screen.getByText('Accessibility')).toBeInTheDocument();
    expect(screen.getByText('Dyslexic font')).toBeInTheDocument();
    expect(screen.getByText('Bionic reading')).toBeInTheDocument();
    expect(screen.getByText('Monochrome')).toBeInTheDocument();
    expect(screen.getByText('Focus mode')).toBeInTheDocument();
  });

  it('closes popover on second click', () => {
    render(<AccessibilityMenu />);
    const trigger = screen.getByTitle('Accessibility options');
    fireEvent.click(trigger);
    expect(screen.getByText('Accessibility')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByText('Accessibility')).not.toBeInTheDocument();
  });

  it('calls toggleDyslexicMode when Dyslexic Font switch is clicked', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility options'));
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);
    expect(mockStore.toggleDyslexicMode).toHaveBeenCalledOnce();
  });

  it('calls toggleBionicReading when Bionic Reading switch is clicked', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility options'));
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[1]);
    expect(mockStore.toggleBionicReading).toHaveBeenCalledOnce();
  });

  it('calls toggleMonochromeMode when Monochrome switch is clicked', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility options'));
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[2]);
    expect(mockStore.toggleMonochromeMode).toHaveBeenCalledOnce();
  });

  it('calls toggleFocusMode when Focus Mode switch is clicked', () => {
    render(<AccessibilityMenu />);
    fireEvent.click(screen.getByTitle('Accessibility options'));
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[3]);
    expect(mockStore.toggleFocusMode).toHaveBeenCalledOnce();
  });

  it('shows accent border when any feature is active', () => {
    mockStore.dyslexicMode = true;
    render(<AccessibilityMenu />);
    const trigger = screen.getByTitle('Accessibility options');
    expect(trigger.className).toContain('border-[var(--color-accent)]');
  });

  it('shows default border when no features active', () => {
    render(<AccessibilityMenu />);
    const trigger = screen.getByTitle('Accessibility options');
    expect(trigger.className).toContain('border-[var(--color-border)]');
  });
});
