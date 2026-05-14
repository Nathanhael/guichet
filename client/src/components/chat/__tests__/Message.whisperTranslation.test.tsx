// Slice 3 (decision 13): the !message.whisper exclusion is removed from the
// useAutoTranslation gate so cross-language whispers translate for colleagues.
// This spec spies on the hook's input to assert the gate is composed correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import Message from '../Message';
import { makeMessage } from '../../../test/helpers';

const useAutoTranslationSpy = vi.hoisted(() =>
  vi.fn(() => ({
    translated: null,
    loading: false,
    translate: vi.fn(),
    showOriginal: false,
    setShowOriginal: vi.fn(),
    needsTranslation: false,
  })),
);

vi.mock('../../../hooks/useSocket', () => ({
  getSocket: () => ({ connected: true, emit: vi.fn() }),
}));
vi.mock('../../../i18n', () => ({ useT: () => (k: string) => k }));
vi.mock('../../../hooks/useTranslation', () => ({
  useAutoTranslation: useAutoTranslationSpy,
}));
vi.mock('../../../store/useStore', () => ({
  default: { getState: () => ({ openLightbox: vi.fn() }) },
  useStoreShallow: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'u-1', name: 'Alice', lang: 'en', role: 'support' },
      bionicReading: false,
    }),
}));

function lastEnabled(): boolean {
  const calls = useAutoTranslationSpy.mock.calls as unknown as Array<[{ enabled?: boolean }]>;
  const args = calls.length ? calls[calls.length - 1][0] : undefined;
  return args?.enabled ?? false;
}

const aiOn = { translation: true, globalAiEnabled: true } as never;
const aiOff = { translation: false, globalAiEnabled: true } as never;

describe('Message — whisper translation gate (slice 3)', () => {
  beforeEach(() => {
    useAutoTranslationSpy.mockClear();
  });

  it('enables translation for whisper messages when AI translation is on', () => {
    const m = makeMessage({
      whisper: true,
      senderId: 'u-other',
      senderName: 'Bob',
      senderLang: 'fr',
      text: 'note privée',
    });
    render(<Message message={m} aiConfig={aiOn} />);
    expect(lastEnabled()).toBe(true);
  });

  it('still disables translation for whisper messages when AI translation is off', () => {
    const m = makeMessage({
      whisper: true,
      senderId: 'u-other',
      senderName: 'Bob',
      senderLang: 'fr',
      text: 'note privée',
    });
    render(<Message message={m} aiConfig={aiOff} />);
    expect(lastEnabled()).toBe(false);
  });

  it('still disables translation for system messages even when AI is on', () => {
    const m = makeMessage({
      system: true,
      senderId: 'system',
      senderLang: 'fr',
      text: 'i18n:transferred_to_dept',
    });
    render(<Message message={m} aiConfig={aiOn} />);
    expect(lastEnabled()).toBe(false);
  });

  it('enables translation for normal cross-language messages (regression)', () => {
    const m = makeMessage({
      whisper: false,
      system: false,
      senderId: 'u-other',
      senderName: 'Bob',
      senderLang: 'fr',
      text: 'bonjour',
    });
    render(<Message message={m} aiConfig={aiOn} />);
    expect(lastEnabled()).toBe(true);
  });
});
