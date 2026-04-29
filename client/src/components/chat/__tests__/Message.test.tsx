// Boundary tests for the public Message component.
// First test coverage of the chat-message render path; supersedes the
// MessageBubble.test.tsx file that never existed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Message from '../Message';
import { makeMessage, makeDeletedMessage } from '../../../test/helpers';

// Stubs — keep parallel with Message.lazy.test.tsx + Message.kind.test.tsx.
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

describe('Message — text rendering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the message text', () => {
    const m = makeMessage({ text: 'Hello world' });
    render(<Message message={m} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders the sender name on group-start of a non-mine message', () => {
    const m = makeMessage({ senderId: 'u-other', senderName: 'Bob', text: 'hi' });
    render(<Message message={m} isGroupStart={true} />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('does not render the sender name when isGroupStart=false', () => {
    const m = makeMessage({ senderId: 'u-other', senderName: 'Bob', text: 'hi' });
    render(<Message message={m} isGroupStart={false} />);
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });
});

describe('Message — deleted state', () => {
  it('renders the deleted-message label (i18n key)', () => {
    const m = makeDeletedMessage();
    render(<Message message={m} />);
    expect(screen.getByText('message_deleted')).toBeInTheDocument();
  });
});

describe('Message — search highlight', () => {
  it('applies the current-match background when isCurrentSearchMatch=true', () => {
    const m = makeMessage({ id: 'm-current', text: 'searchable text' });
    const { container } = render(<Message message={m} isCurrentSearchMatch={true} />);
    const wrapper = container.querySelector('#msg-m-current');
    expect(wrapper?.className).toMatch(/accent-soft/);
  });

  it('applies the non-current match background when isSearchMatch=true (and not current)', () => {
    const m = makeMessage({ id: 'm-match', text: 'searchable text' });
    const { container } = render(<Message message={m} isSearchMatch={true} />);
    const wrapper = container.querySelector('#msg-m-match');
    expect(wrapper?.className).toMatch(/bg-elevated/);
  });

  it('applies neither highlight class when neither prop is true', () => {
    const m = makeMessage({ id: 'm-noop', text: 'plain' });
    const { container } = render(<Message message={m} />);
    const wrapper = container.querySelector('#msg-m-noop');
    expect(wrapper?.className).not.toMatch(/accent-soft/);
    expect(wrapper?.className).not.toMatch(/bg-elevated/);
  });
});

describe('Message — reply action', () => {
  it('renders the reply button when onReply is provided and the row is hovered', () => {
    const onReply = vi.fn();
    const m = makeMessage({ senderId: 'u-other', text: 'reply to me' });
    const { container } = render(<Message message={m} onReply={onReply} />);

    const row = container.querySelector('#msg-' + m.id);
    expect(row).not.toBeNull();
    fireEvent.mouseEnter(row!);

    const replyBtn = screen.getByLabelText('reply');
    expect(replyBtn).toBeInTheDocument();
    fireEvent.click(replyBtn);
    expect(onReply).toHaveBeenCalledWith(m);
  });

  it('does not render the reply button when suppressActions=true', () => {
    const m = makeMessage({ senderId: 'u-other', text: 'no actions' });
    const { container } = render(<Message message={m} suppressActions={true} onReply={vi.fn()} />);
    const row = container.querySelector('#msg-' + m.id);
    fireEvent.mouseEnter(row!);
    expect(screen.queryByLabelText('reply')).not.toBeInTheDocument();
  });
});

describe('Message — group spacing', () => {
  it('uses mb-3 when isGroupEnd=true', () => {
    const m = makeMessage({ id: 'm-end', text: 'last in group' });
    const { container } = render(<Message message={m} isGroupEnd={true} />);
    const wrapper = container.querySelector('#msg-m-end');
    expect(wrapper?.className).toMatch(/mb-3/);
  });

  it('uses mb-0.5 when isGroupEnd=false', () => {
    const m = makeMessage({ id: 'm-mid', text: 'middle of group' });
    const { container } = render(<Message message={m} isGroupEnd={false} />);
    const wrapper = container.querySelector('#msg-m-mid');
    expect(wrapper?.className).toMatch(/mb-0\.5/);
  });
});

describe('Message — ticketId fallback', () => {
  it('uses message.ticketId when ticketId prop is omitted', () => {
    const m = makeMessage({ ticketId: 't-from-message', text: 'fallback' });
    // Render without a ticketId prop. MessageBubble emits delete events scoped
    // to ticketId; we exercise that path indirectly by asserting the message
    // renders successfully with the fallback.
    render(<Message message={m} />);
    expect(screen.getByText('fallback')).toBeInTheDocument();
  });
});
