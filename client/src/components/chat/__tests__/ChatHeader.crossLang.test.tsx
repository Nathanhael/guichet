import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Minimal store + translation stubs; real ChatHeader has many deps so we
// render a lightweight wrapper that exercises just the banner branch.
vi.mock('../../../store/useStore', () => ({
  default: (selector: (s: unknown) => unknown) => selector({
    allLabels: [],
    onlineSupportUsers: [],
    user: { id: 'u1', role: 'support', lang: 'fr', isExternal: false },
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
});
