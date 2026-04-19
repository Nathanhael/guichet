import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

// Minimal store + translation stubs; real ChatHeader has many deps so we
// render a lightweight wrapper that exercises just the banner branch.
// `storeState.messages` is mutated per-test to exercise the
// "self-dismiss after first support reply" branch.
const storeState: { messages: Record<string, Array<{ senderId: string; whisper?: boolean; system?: boolean }>> } = {
  messages: {},
};

vi.mock('../../../store/useStore', () => ({
  default: (selector: (s: unknown) => unknown) => selector({
    allLabels: [],
    onlineSupportUsers: [],
    user: { id: 'u1', role: 'support', lang: 'fr', isExternal: false },
    messages: storeState.messages,
  }),
  useStoreShallow: (selector: (s: unknown) => unknown) => selector({
    allLabels: [],
    onlineSupportUsers: [],
  }),
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key === 'chat_cross_lang_banner' ? 'Replies are auto-translated to {lang} for the agent.' : key,
  useLang: () => 'fr',
}));

vi.mock('../../../hooks/usePartner', () => ({ usePartner: () => ({ manifest: { departments: [] } }) }));
vi.mock('../../../hooks/useSocket', () => ({ getSocket: () => null }));
vi.mock('../../UserAvatar', () => ({ default: () => null }));
vi.mock('../../SlaIndicator', () => ({ default: () => null }));

import ChatHeader from '../ChatHeader';

function makeTicket(agentLang: string) {
  return {
    id: 't1', partnerId: 'p', agentId: 'a', agentName: 'Agent', agentLang,
    dept: 'support', status: 'open', supportId: null, participants: [], references: [], labels: [],
  } as unknown as Parameters<typeof ChatHeader>[0]['ticket'];
}

describe('ChatHeader cross-lang banner', () => {
  beforeEach(() => {
    storeState.messages = {};
  });

  it('renders the banner when ticket lang differs from viewer lang', () => {
    const ticket = makeTicket('nl');
    render(<ChatHeader
      ticket={ticket} liveTicket={ticket}
      isSupport={true} isClosed={false}
      focusMode={false} compact={false}
      showTransferMenu={false} setShowTransferMenu={() => {}} onTransfer={() => {}}
      closing={false} canClose={true} agentIsOnline={true}
      onCloseTicket={() => {}}
    />);
    expect(screen.getByText(/auto-translated to NL/i)).toBeInTheDocument();
  });

  it('omits the banner when ticket lang matches viewer lang', () => {
    const ticket = makeTicket('fr');
    render(<ChatHeader
      ticket={ticket} liveTicket={ticket}
      isSupport={true} isClosed={false}
      focusMode={false} compact={false}
      showTransferMenu={false} setShowTransferMenu={() => {}} onTransfer={() => {}}
      closing={false} canClose={true} agentIsOnline={true}
      onCloseTicket={() => {}}
    />);
    expect(screen.queryByText(/auto-translated/i)).toBeNull();
  });

  it('self-dismisses banner after current support has sent a non-whisper reply', () => {
    const ticket = makeTicket('nl');
    storeState.messages = {
      t1: [{ senderId: 'u1', whisper: false, system: false }],
    };
    render(<ChatHeader
      ticket={ticket} liveTicket={ticket}
      isSupport={true} isClosed={false}
      focusMode={false} compact={false}
      showTransferMenu={false} setShowTransferMenu={() => {}} onTransfer={() => {}}
      closing={false} canClose={true} agentIsOnline={true}
      onCloseTicket={() => {}}
    />);
    expect(screen.queryByText(/auto-translated/i)).toBeNull();
  });

  it('keeps banner visible when only whispers/system messages exist from current user', () => {
    const ticket = makeTicket('nl');
    storeState.messages = {
      t1: [
        { senderId: 'u1', whisper: true, system: false },
        { senderId: 'u1', whisper: false, system: true },
      ],
    };
    render(<ChatHeader
      ticket={ticket} liveTicket={ticket}
      isSupport={true} isClosed={false}
      focusMode={false} compact={false}
      showTransferMenu={false} setShowTransferMenu={() => {}} onTransfer={() => {}}
      closing={false} canClose={true} agentIsOnline={true}
      onCloseTicket={() => {}}
    />);
    expect(screen.getByText(/auto-translated to NL/i)).toBeInTheDocument();
  });

  it('keeps banner visible when messages exist only from other users', () => {
    const ticket = makeTicket('nl');
    storeState.messages = {
      t1: [{ senderId: 'other-user', whisper: false, system: false }],
    };
    render(<ChatHeader
      ticket={ticket} liveTicket={ticket}
      isSupport={true} isClosed={false}
      focusMode={false} compact={false}
      showTransferMenu={false} setShowTransferMenu={() => {}} onTransfer={() => {}}
      closing={false} canClose={true} agentIsOnline={true}
      onCloseTicket={() => {}}
    />);
    expect(screen.getByText(/auto-translated to NL/i)).toBeInTheDocument();
  });
});
