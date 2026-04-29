// Render-variant coverage that wasn't in slice 2's Message.test.tsx:
// system messages and whisper messages.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Message from '../Message';
import { makeMessage } from '../../../test/helpers';

vi.mock('../../../hooks/useSocket', () => ({
  getSocket: () => ({ connected: true, emit: vi.fn() }),
}));
vi.mock('../../../i18n', () => ({ useT: () => (k: string) => k }));
vi.mock('../../../hooks/useTranslation', () => ({
  useAutoTranslation: () => ({
    translated: null,
    loading: false,
    translate: vi.fn(),
    showOriginal: false,
    setShowOriginal: vi.fn(),
    needsTranslation: false,
  }),
}));
vi.mock('../../../store/useStore', () => ({
  default: { getState: () => ({ openLightbox: vi.fn() }) },
  useStoreShallow: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'u-1', name: 'Alice', lang: 'en', role: 'agent' },
      bionicReading: false,
    }),
}));

describe('Message — system kind', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the system pill (no avatar, no bubble) for system messages', () => {
    const m = makeMessage({ system: true, text: 'Ticket transferred to Tier 2.' });
    const { container } = render(<Message message={m} />);
    expect(screen.getByText('Ticket transferred to Tier 2.')).toBeInTheDocument();
    // No bubble class
    expect(container.querySelector('.bubble-sent')).toBeNull();
    expect(container.querySelector('.bubble-received')).toBeNull();
    expect(container.querySelector('.bubble-whisper')).toBeNull();
  });

  it('resolves i18n: prefixed system message text', () => {
    const m = makeMessage({ system: true, text: 'i18n:transferred_to_dept' });
    render(<Message message={m} />);
    // useT pass-through stub returns the key, so we expect the resolved key (without "i18n:")
    expect(screen.getByText('transferred_to_dept')).toBeInTheDocument();
  });
});

describe('Message — whisper kind', () => {
  it('applies the whisper bubble class for whisper messages from non-self', () => {
    const m = makeMessage({ whisper: true, senderId: 'u-other', senderName: 'Bob', text: 'private note' });
    const { container } = render(<Message message={m} />);
    expect(container.querySelector('.bubble-whisper')).not.toBeNull();
    expect(screen.getByText('private note')).toBeInTheDocument();
  });

  it('applies the whisper bubble class for whisper messages from self (whisper takes precedence over isMine)', () => {
    const m = makeMessage({ whisper: true, senderId: 'u-1', senderName: 'Alice', text: 'own whisper' });
    const { container } = render(<Message message={m} />);
    // Whisper class wins over sent class.
    expect(container.querySelector('.bubble-whisper')).not.toBeNull();
    expect(container.querySelector('.bubble-sent')).toBeNull();
  });

  it('renders the whisper label + ghost icon on group-start of a whisper run', () => {
    const m = makeMessage({ whisper: true, senderId: 'u-other', senderName: 'Bob', text: 'first whisper' });
    render(<Message message={m} isGroupStart={true} />);
    expect(screen.getByText('whisper_label')).toBeInTheDocument();
  });
});
