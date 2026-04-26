/**
 * Boundary tests for the deepened useComposeEditor hook.
 *
 * Mounts the hook via a Harness component that renders <EditorContent>
 * + <PickerPortals /> and exposes the live handle to the test. Tiptap
 * is real — onUpdate fires from prosemirror internals, picker triggers
 * depend on `:` / `/` flowing through real input handling. Mocked Tiptap
 * would lie about the exact ping-pong / ordering bugs this refactor exists
 * to kill.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { EditorContent } from '@tiptap/react';
import type { Ticket, User } from '../types';

// useSocket is referenced by the typing-emit branch. Mock at module level
// so tests can assert exactly what was emitted, regardless of the real
// socket.io singleton's connection state in jsdom.
const socketEmit = vi.fn();
vi.mock('./useSocket', () => ({
  getSocket: () => ({ emit: socketEmit }),
  disconnectSocket: () => {},
  useSocket: () => null,
}));

// CannedResponsePicker fetches via tRPC and pulls from the global store —
// stub it with a marker so test 8 can assert the canned popup mounted
// without dragging the network layer into the test. The stub also
// captures the live onSelect prop so the test can drive a selection.
let cannedOnSelect: ((body: string) => void) | null = null;
vi.mock('../components/CannedResponsePicker', () => ({
  default: (props: { onSelect: (body: string) => void }) => {
    cannedOnSelect = props.onSelect;
    return <div data-testid="canned-picker-stub" />;
  },
}));

import { useComposeEditor, type ComposeEditorHandle } from './useComposeEditor';

const user: User = {
  id: 'u1',
  name: 'Test Support',
  role: 'support',
  lang: 'en',
  isPlatformOperator: false,
};

const ticket: Ticket = {
  id: 't1',
  dept: 'general',
  agentId: 'a1',
  agentName: 'Agent',
  agentLang: 'en',
  status: 'open',
  createdAt: '2026-04-26T00:00:00Z',
  participants: [],
  labels: [],
};

interface HarnessProps {
  options?: Partial<Parameters<typeof useComposeEditor>[0]>;
  capture: (handle: ComposeEditorHandle) => void;
}

function Harness({ options, capture }: HarnessProps) {
  const compose = useComposeEditor({
    ticket,
    user,
    whisperMode: false,
    isSupport: true,
    placeholder: 'Type a message',
    onSubmit: () => {},
    ...options,
  });
  capture(compose);
  return (
    <div>
      <EditorContent editor={compose.editor} />
      <compose.PickerPortals />
    </div>
  );
}

function captureRef() {
  const ref: { current: ComposeEditorHandle | null } = { current: null };
  const capture = (h: ComposeEditorHandle) => {
    ref.current = h;
  };
  return { ref, capture };
}

// jsdom doesn't implement scrollIntoView, but EmojiSuggestion calls it
// when the selection index changes. Stub to a no-op.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

// ProseMirror's scrollToSelection (triggered by editor.commands.focus())
// calls Range.getClientRects(), which jsdom only partially implements.
// Stub both shapes so the focus path doesn't throw on mount.
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function () {
      return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
    };
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () =>
      ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }
}

describe('useComposeEditor', () => {
  beforeEach(() => {
    localStorage.clear();
    socketEmit.mockClear();
    cannedOnSelect = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates draft from localStorage on mount; isDraftLoaded flips true', () => {
    localStorage.setItem(
      'guichet:draft:u1:t1:regular',
      JSON.stringify({ text: 'restored draft', ts: Date.now() }),
    );
    const { ref, capture } = captureRef();
    render(<Harness capture={capture} />);

    expect(ref.current?.isDraftLoaded).toBe(true);
    expect(ref.current?.text).toBe('restored draft');
  });

  it('persists draft to localStorage after 400ms of debounced inactivity', () => {
    vi.useFakeTimers();
    const { ref, capture } = captureRef();
    render(<Harness capture={capture} />);

    act(() => {
      ref.current!.editor!.commands.insertContent('hello');
    });

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(localStorage.getItem('guichet:draft:u1:t1:regular')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const raw = localStorage.getItem('guichet:draft:u1:t1:regular');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).text).toBe('hello');
  });

  it('clear() empties text, removes draft from storage, stops typing emit', () => {
    vi.useFakeTimers();
    localStorage.setItem(
      'guichet:draft:u1:t1:regular',
      JSON.stringify({ text: 'prior', ts: Date.now() }),
    );
    const { ref, capture } = captureRef();
    render(<Harness capture={capture} />);

    // Drive a real keystroke so typing:start has been emitted —
    // otherwise there's no active typing for clear() to stop.
    act(() => {
      ref.current!.editor!.commands.insertContent(' more');
    });
    expect(socketEmit).toHaveBeenCalledWith('typing:start', expect.anything());

    socketEmit.mockClear();
    act(() => {
      ref.current!.clear();
    });

    expect(ref.current!.text).toBe('');
    expect(localStorage.getItem('guichet:draft:u1:t1:regular')).toBeNull();
    expect(socketEmit).toHaveBeenCalledWith(
      'typing:stop',
      expect.objectContaining({ ticketId: 't1' }),
    );
  });

  it('emits typing:start on first keystroke and typing:stop after the idle window', () => {
    vi.useFakeTimers();
    const { ref, capture } = captureRef();
    render(<Harness capture={capture} />);

    act(() => {
      ref.current!.editor!.commands.insertContent('h');
    });
    expect(socketEmit).toHaveBeenCalledWith(
      'typing:start',
      expect.objectContaining({ ticketId: 't1', whisper: false }),
    );

    // Subsequent keystrokes inside the idle window don't re-emit start —
    // a single rolling timer is reset on each update.
    socketEmit.mockClear();
    act(() => {
      ref.current!.editor!.commands.insertContent('i');
    });
    expect(socketEmit).not.toHaveBeenCalledWith('typing:start', expect.anything());

    // After 2s of idle, typing:stop fires automatically.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(socketEmit).toHaveBeenCalledWith(
      'typing:stop',
      expect.objectContaining({ ticketId: 't1', whisper: false }),
    );
  });

  it('replaceText() does NOT fire typing:start', () => {
    const { ref, capture } = captureRef();
    render(<Harness capture={capture} />);

    act(() => {
      ref.current!.replaceText('> quoted line\n\n');
    });

    expect(socketEmit).not.toHaveBeenCalledWith('typing:start', expect.anything());
    expect(ref.current!.text).toBe('> quoted line\n\n');
  });

  it('replaceText() does not loop the editor↔text sync (no ghost edits, no flicker)', async () => {
    const { ref, capture } = captureRef();
    render(<Harness capture={capture} />);

    act(() => {
      ref.current!.replaceText('rewrite one');
    });
    // Flush any echoed onUpdate from setContent — the guard should
    // suppress it, but the test exercises the post-microtask state.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      ref.current!.replaceText('rewrite two');
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Last write wins — no leftover state from a prior loop iteration.
    expect(ref.current!.text).toBe('rewrite two');

    // Editor and text are in lockstep — a lossy round-trip would land
    // here as a divergence between the two.
    const editor = ref.current!.editor!;
    const storage = editor.storage as { markdown?: { getMarkdown(): string } };
    const editorMarkdown = (storage.markdown?.getMarkdown() ?? editor.getText()).trim();
    expect(editorMarkdown).toBe('rewrite two');

    // And — belt and braces — the rewrite path didn't sneak a typing
    // emit through despite the round-trip.
    expect(socketEmit).not.toHaveBeenCalledWith('typing:start', expect.anything());
  });

  it('typing :smi opens emoji suggestion via PickerPortals; selection inserts via editor', () => {
    const { ref, capture } = captureRef();
    render(<Harness capture={capture} />);

    act(() => {
      ref.current!.editor!.commands.insertContent(':smi');
    });

    // PickerPortals renders the EmojiSuggestion popup into document.body
    // (via createPortal). The suggestion buttons each show ':<name>'.
    const matchingButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
    ).find((b) => /smi/i.test(b.textContent || ''));
    expect(matchingButton).toBeTruthy();

    // The first <span> inside the button holds the actual emoji glyph.
    const emojiGlyph = matchingButton!.querySelector('span')?.textContent ?? '';
    expect(emojiGlyph.length).toBeGreaterThan(0);

    act(() => {
      fireEvent.mouseDown(matchingButton!);
    });

    expect(ref.current!.text).toContain(emojiGlyph);
    expect(ref.current!.text).not.toMatch(/:smi/);
  });

  it('typing / opens canned picker via PickerPortals; selection inserts the chosen body', () => {
    const { ref, capture } = captureRef();
    render(<Harness capture={capture} />);

    act(() => {
      ref.current!.editor!.commands.insertContent('/');
    });

    expect(document.body.querySelector('[data-testid="canned-picker-stub"]')).toBeTruthy();
    expect(cannedOnSelect).toBeTruthy();

    act(() => {
      cannedOnSelect!('Hello, this is a canned reply.');
    });

    expect(ref.current!.text).toBe('Hello, this is a canned reply.');
    // Picker should close after selection so a stale `/` buffer doesn't
    // re-open it on the very next render.
    expect(document.body.querySelector('[data-testid="canned-picker-stub"]')).toBeNull();
  });
});
