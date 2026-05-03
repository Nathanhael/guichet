/**
 * Verifies the picker's lang-aware endpoint routing for cannedTranslation:
 *   - Feature OFF → always uses `list` (single body, untranslated).
 *   - Feature ON + ticketId present → uses `getForPicker` (server-side lang
 *     resolution; the picker just inserts what it gets).
 *   - Feature ON but no ticketId → still uses `list` (no resolution context).
 *   - The body returned by the active endpoint is what gets inserted on click.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CannedResponsePicker from '../CannedResponsePicker';

const h = vi.hoisted(() => ({
  cannedTranslation: false,
  listEnabled: false,
  pickerEnabled: false,
  listData: [{ id: 'c1', title: 'Greeting', body: 'Hello (source)', shortcut: null, dept: null }],
  pickerData: [{ id: 'c1', title: 'Greeting', body: 'Hello (resolved-NL)', shortcut: null, dept: null }],
}));

vi.mock('../../i18n', () => ({
  useT: () => (k: string) => k,
}));

vi.mock('../../store/useStore', () => {
  const fn = (selector: (s: { user: { lang: string } }) => unknown) =>
    selector({ user: { lang: 'en' } });
  fn.getState = () => ({ user: { name: 'Sam' } });
  return { default: fn };
});

vi.mock('../../utils/trpc', () => ({
  trpc: {
    partner: {
      getAiConfig: {
        useQuery: () => ({ data: { cannedTranslation: h.cannedTranslation } }),
      },
    },
    cannedResponse: {
      getForPicker: {
        useQuery: (_input: unknown, opts: { enabled: boolean }) => {
          h.pickerEnabled = !!opts.enabled;
          return { data: opts.enabled ? h.pickerData : undefined };
        },
      },
      list: {
        useQuery: (_input: unknown, opts: { enabled: boolean }) => {
          h.listEnabled = !!opts.enabled;
          return { data: opts.enabled ? h.listData : undefined };
        },
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.cannedTranslation = false;
  h.listEnabled = false;
  h.pickerEnabled = false;
  // jsdom doesn't implement scrollIntoView; stub it so the picker's
  // post-render effect doesn't blow up.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('CannedResponsePicker — endpoint routing', () => {
  it('uses list endpoint (and not getForPicker) when feature is OFF', () => {
    render(
      <CannedResponsePicker
        inputText="/"
        ticketId="t1"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(h.listEnabled).toBe(true);
    expect(h.pickerEnabled).toBe(false);
    expect(screen.getByText('Greeting')).toBeInTheDocument();
  });

  it('uses getForPicker endpoint when feature is ON and ticketId is present', () => {
    h.cannedTranslation = true;
    render(
      <CannedResponsePicker
        inputText="/"
        ticketId="t1"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(h.pickerEnabled).toBe(true);
    expect(h.listEnabled).toBe(false);
  });

  it('falls back to list endpoint when feature is ON but ticketId is missing', () => {
    h.cannedTranslation = true;
    render(
      <CannedResponsePicker
        inputText="/"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(h.listEnabled).toBe(true);
    expect(h.pickerEnabled).toBe(false);
  });

  it('inserts the picker-endpoint body (already lang-resolved by server) when feature is ON', () => {
    h.cannedTranslation = true;
    const onSelect = vi.fn();
    render(
      <CannedResponsePicker
        inputText="/"
        ticketId="t1"
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Greeting'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBe('Hello (resolved-NL)');
  });

  it('inserts the source body when feature is OFF', () => {
    const onSelect = vi.fn();
    render(
      <CannedResponsePicker
        inputText="/"
        ticketId="t1"
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Greeting'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBe('Hello (source)');
  });
});
