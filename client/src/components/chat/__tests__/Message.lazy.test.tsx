// Asserts:
// 1. Plain-text messages do NOT trigger a Suspense boundary — verified by
//    asserting no fallback element appears in the DOM.
// 2. Messages with attachments / quote / link-preview DO trigger a Suspense
//    boundary — verified by waitFor on the rendered fragment.
// 3. Verify-can-fail: the same probe used in (1) flags positive in (2),
//    proving the assertion isn't a no-op.
//
// IMPORTANT: the verify-can-fail probe MUST run BEFORE the positive lazy
// tests because React.lazy caches the resolved module per component
// definition. Once the chunk has been loaded once in jsdom, subsequent
// renders of the same component never show the Suspense fallback again
// (React renders the loaded module synchronously).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Message from '../Message';
import {
  makeMessage,
  makeMessageWithAttachment,
  makeMessageWithQuote,
  makeMessageWithLinkPreview,
} from '../../../test/helpers';

// Same stubs as Message.test.tsx — keep parity to isolate lazy behavior.
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

/**
 * Probe: returns true when an aria-hidden Suspense fallback is currently
 * in the DOM. MessageContent renders fallbacks as
 * `<div style={{ minHeight: N }} aria-hidden="true" />`.
 */
function hasFallbackInDom(container: HTMLElement): boolean {
  return container.querySelectorAll('div[aria-hidden="true"][style*="min-height"]').length > 0;
}

// MUST be the first describe in the file — see header comment.
describe('Message — verify-can-fail probe (runs first to bypass lazy cache)', () => {
  it('the fallback probe is non-trivial: detects the boundary on attachment messages while plain stays clean', async () => {
    const plain = makeMessage({ text: 'plain probe' });
    const withAttachment = makeMessageWithAttachment();

    const plainResult = render(<Message message={plain} />);
    await Promise.resolve();
    const plainHasFallback = hasFallbackInDom(plainResult.container);
    plainResult.unmount();

    const attachResult = render(<Message message={withAttachment} />);
    // BEFORE the lazy chunk resolves, the fallback IS in the DOM. Probe it
    // synchronously, before any await.
    const attachHasFallback = hasFallbackInDom(attachResult.container);

    expect(plainHasFallback).toBe(false);
    expect(attachHasFallback).toBe(true);
    // If either of those is wrong, the probe is broken — and so are the
    // positive-case assertions below.
  });
});

describe('Message — lazy fragments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('plain-text message: no Suspense fallback ever appears', async () => {
    const m = makeMessage({ text: 'plain' });
    const { container } = render(<Message message={m} />);
    expect(screen.getByText('plain')).toBeInTheDocument();
    // Wait one microtask cycle to confirm no fallback flickered in.
    await Promise.resolve();
    expect(hasFallbackInDom(container)).toBe(false);
  });

  it('attachment message: AttachmentGrid renders after Suspense resolves', async () => {
    const m = makeMessageWithAttachment({ text: 'with file' });
    const { container } = render(<Message message={m} />);
    await waitFor(() => {
      // AttachmentGrid renders an <img> or <a href="/uploads/..."> for the attachment.
      expect(container.querySelector('img[alt], a[href*="/uploads/"]')).not.toBeNull();
    });
  });

  it('quote message: QuoteBlock renders after Suspense resolves', async () => {
    const m = makeMessageWithQuote({ text: 'reply text' });
    render(<Message message={m} />);
    await waitFor(() => {
      // QuoteBlock renders the original sender name.
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('link-preview message: LinkPreviewCard renders after Suspense resolves', async () => {
    const m = makeMessageWithLinkPreview({ text: 'see this' });
    render(<Message message={m} />);
    await waitFor(() => {
      // LinkPreviewCard renders the preview title.
      expect(screen.getByText('Example')).toBeInTheDocument();
    });
  });
});
