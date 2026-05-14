// Slice 6 of AI rollout: render the ✨ AI badge next to the timestamp when
// the message has been AI-improved (improvedAt set) or is currently being
// shown to the viewer in a translated form. The badge's title attribute
// carries the i18n key so screen readers / hover tooltips have the right
// localized string.
//
// These tests use the same hoisted-spy pattern as Message.whisperTranslation
// because the translation-state path requires controlling
// `useAutoTranslation`'s return.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import Message from '../Message';
import { makeMessage } from '../../../test/helpers';

const useAutoTranslationSpy = vi.hoisted(() =>
  vi.fn(() => ({
    translated: null as string | null,
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
      user: { id: 'u-viewer', name: 'Viewer', lang: 'en', role: 'support' },
      bionicReading: false,
    }),
}));

const aiOn = { translation: true, globalAiEnabled: true } as never;

describe('Message — AI badge (slice 6)', () => {
  beforeEach(() => {
    useAutoTranslationSpy.mockReset();
    useAutoTranslationSpy.mockReturnValue({
      translated: null,
      loading: false,
      translate: vi.fn(),
      showOriginal: false,
      setShowOriginal: vi.fn(),
      needsTranslation: false,
    });
  });

  it('renders the ✨ badge when message.improvedAt is set', () => {
    const m = makeMessage({
      senderId: 'u-viewer',
      senderName: 'Viewer',
      senderLang: 'en',
      text: 'polished outgoing message',
      improvedAt: '2026-05-02T10:00:00.000Z',
    });
    const { container } = render(<Message message={m} />);
    const badge = container.querySelector('[data-testid="ai-badge"]');
    expect(badge).not.toBeNull();
    // Tooltip = i18n key (mocked passthrough) for "improved" mode.
    expect(badge?.getAttribute('title')).toBe('ai_badge_improved');
  });

  it('renders the ✨ badge when the message is currently being shown translated', () => {
    // Translation hook says: needsTranslation true, translated text available,
    // viewer has NOT toggled showOriginal — so the displayed text is the
    // translation, not the original. Badge should appear with the
    // translation-mode tooltip.
    useAutoTranslationSpy.mockReturnValue({
      translated: 'translated body',
      loading: false,
      translate: vi.fn(),
      showOriginal: false,
      setShowOriginal: vi.fn(),
      needsTranslation: true,
    });
    const m = makeMessage({
      senderId: 'u-other',
      senderName: 'Bob',
      senderLang: 'fr',
      text: 'bonjour',
    });
    const { container } = render(<Message message={m} aiConfig={aiOn} />);
    const badge = container.querySelector('[data-testid="ai-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('title')).toBe('ai_badge_translated');
  });

  it('does NOT render the badge when neither improvedAt nor active translation applies', () => {
    const m = makeMessage({
      senderId: 'u-viewer',
      senderName: 'Viewer',
      senderLang: 'en',
      text: 'plain message',
    });
    const { container } = render(<Message message={m} />);
    expect(container.querySelector('[data-testid="ai-badge"]')).toBeNull();
  });

  it('renders a single combined badge when both improvedAt and translation apply', () => {
    useAutoTranslationSpy.mockReturnValue({
      translated: 'translated body',
      loading: false,
      translate: vi.fn(),
      showOriginal: false,
      setShowOriginal: vi.fn(),
      needsTranslation: true,
    });
    const m = makeMessage({
      senderId: 'u-other',
      senderName: 'Bob',
      senderLang: 'fr',
      text: 'bonjour',
      improvedAt: '2026-05-02T10:00:00.000Z',
    });
    const { container } = render(<Message message={m} aiConfig={aiOn} />);
    const badges = container.querySelectorAll('[data-testid="ai-badge"]');
    expect(badges.length).toBe(1);
    // Combined tooltip: "translated · improved" (translation listed first).
    const title = badges[0]?.getAttribute('title') || '';
    expect(title).toContain('ai_badge_translated');
    expect(title).toContain('ai_badge_improved');
  });

  it('does NOT render the badge for a translation-eligible message when the viewer toggled to original', () => {
    useAutoTranslationSpy.mockReturnValue({
      translated: 'translated body',
      loading: false,
      translate: vi.fn(),
      showOriginal: true,
      setShowOriginal: vi.fn(),
      needsTranslation: true,
    });
    const m = makeMessage({
      senderId: 'u-other',
      senderName: 'Bob',
      senderLang: 'fr',
      text: 'bonjour',
    });
    const { container } = render(<Message message={m} aiConfig={aiOn} />);
    expect(container.querySelector('[data-testid="ai-badge"]')).toBeNull();
  });
});
