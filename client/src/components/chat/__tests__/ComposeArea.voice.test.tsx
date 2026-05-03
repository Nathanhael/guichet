import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// ComposeArea is a fat component with many side-effect deps (sockets, tRPC,
// Tiptap, draft persistence). For voice-button branching we mock every dep
// and drive useVoiceTranscribe explicitly so each scenario isolates the
// gate logic. Tiptap's useEditor is replaced with a stub so jsdom doesn't
// have to render a real prosemirror view.
// ---------------------------------------------------------------------------

vi.mock('@tiptap/react', () => ({
  useEditor: () => ({
    storage: { characterCount: { characters: () => 0 } },
    chain: () => ({ focus: () => ({ insertContent: () => ({ run: () => undefined }) }) }),
    commands: { setContent: () => undefined, focus: () => undefined },
    on: () => undefined,
    off: () => undefined,
    isDestroyed: false,
    view: { dom: { setAttribute: () => undefined } },
    extensionManager: { extensions: [] },
  }),
  EditorContent: () => null,
}));

vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-character-count', () => ({ default: { configure: () => ({}) } }));
vi.mock('tiptap-markdown', () => ({ Markdown: { configure: () => ({}) } }));

vi.mock('../../../store/useStore', () => {
  const state = { user: { id: 'u', name: 'U', role: 'support', lang: 'en' }, lastRejection: null };
  const fn = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
  fn.getState = () => ({ ...state, addMessage: () => undefined, updateMessageState: () => undefined });
  fn.setState = () => undefined;
  return {
    default: fn,
    useStoreShallow: (selector: (s: unknown) => unknown) => selector(state),
  };
});

vi.mock('../../../hooks/useSocket', () => ({ getSocket: () => null }));
vi.mock('../../../hooks/useComposeAttachments', () => ({
  useComposeAttachments: () => ({
    pendingFiles: [],
    uploading: false,
    isDragOver: false,
    fileInputRef: { current: null },
    removeFile: () => undefined,
    clearMedia: () => undefined,
    uploadFiles: async () => [],
    handleFileChange: () => undefined,
    handlePaste: () => undefined,
    dragProps: {},
  }),
}));
vi.mock('../../../hooks/useComposeLinkPreview', () => ({
  useComposeLinkPreview: () => ({ livePreview: null, dismiss: () => undefined }),
}));
vi.mock('../../../hooks/useComposeAiImprove', () => ({
  useComposeAiImprove: () => ({
    originalText: null,
    improving: false,
    improvementMode: 'off',
    handleImprove: () => Promise.resolve(),
    revertImprove: () => undefined,
    improveAndSend: () => Promise.resolve(),
    reset: () => undefined,
    pendingImprove: null,
    confirmSendImproved: () => Promise.resolve(),
    confirmSendOriginal: () => Promise.resolve(),
    dismissImprove: () => undefined,
    lastUsageLogId: null,
  }),
}));
vi.mock('../../../hooks/useAiHealth', () => ({
  useAiHealth: () => ({ available: true, lastChecked: null }),
}));
vi.mock('../../../hooks/useComposeEditor', () => ({
  useComposeEditor: () => ({
    editor: {
      storage: { characterCount: { characters: () => 0 } },
    },
    text: '',
    replaceText: () => undefined,
    PickerPortals: () => null,
    clear: () => undefined,
    focus: () => undefined,
    isDraftLoaded: false,
    emojiAnchorRef: { current: null },
    toggleEmojiGrid: () => undefined,
    isEmojiGridOpen: false,
  }),
}));

// Voice hook mock — drive return values per test via this mutable holder.
const voiceState = {
  isRecording: false,
  isTranscribing: false,
  elapsedSec: 0,
  error: null as string | null,
  startRecording: vi.fn(async () => undefined),
  stopRecording: vi.fn(async () => undefined),
  cancelRecording: vi.fn(),
  isSupported: true,
};
vi.mock('../../../hooks/useVoiceTranscribe', () => ({
  useVoiceTranscribe: () => voiceState,
}));

// Translation hook is invoked unconditionally by the reply-preview wiring
// (commit 3e31a4e follow-up). Stub it to avoid pulling tRPC into the voice
// gate tests; gate behaviour is unrelated to translation.
vi.mock('../../../hooks/useTranslation', () => ({
  useAutoTranslation: () => ({
    translated: null,
    loading: false,
    translate: () => undefined,
    showOriginal: false,
    setShowOriginal: () => undefined,
    needsTranslation: false,
  }),
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

import ComposeArea from '../ComposeArea';
import type { Ticket } from '../../../types';

function makeTicket(): Ticket {
  return {
    id: 't1',
    partnerId: 'p',
    agentId: 'a',
    agentName: 'Agent',
    agentLang: 'en',
    dept: 'support',
    status: 'open',
    supportId: null,
    participants: [],
    references: [],
    labels: [],
  } as unknown as Ticket;
}

function resetVoice() {
  voiceState.isRecording = false;
  voiceState.isTranscribing = false;
  voiceState.elapsedSec = 0;
  voiceState.error = null;
  voiceState.startRecording = vi.fn(async () => undefined);
  voiceState.stopRecording = vi.fn(async () => undefined);
  voiceState.cancelRecording = vi.fn();
  voiceState.isSupported = true;
}

describe('ComposeArea voice transcription', () => {
  beforeEach(() => {
    resetVoice();
  });

  it('hides the mic button when aiConfig.voiceTranscription is false', () => {
    render(
      <ComposeArea
        ticket={makeTicket()}
        isClosed={false}
        isSupport={true}
        aiConfig={{ voiceTranscription: false }}
      />,
    );
    expect(screen.queryByLabelText('voice_start')).not.toBeInTheDocument();
  });

  it('hides the mic button when isSupport=false (agent surface, even if voiceTranscription=true)', () => {
    render(
      <ComposeArea
        ticket={makeTicket()}
        isClosed={false}
        isSupport={false}
        aiConfig={{ voiceTranscription: true }}
      />,
    );
    expect(screen.queryByLabelText('voice_start')).not.toBeInTheDocument();
  });

  it('hides the mic button when MediaRecorder is unsupported (isSupported=false)', () => {
    voiceState.isSupported = false;
    render(
      <ComposeArea
        ticket={makeTicket()}
        isClosed={false}
        isSupport={true}
        aiConfig={{ voiceTranscription: true }}
      />,
    );
    expect(screen.queryByLabelText('voice_start')).not.toBeInTheDocument();
  });

  it('shows the mic button when partner-enabled, support, and supported', () => {
    render(
      <ComposeArea
        ticket={makeTicket()}
        isClosed={false}
        isSupport={true}
        aiConfig={{ voiceTranscription: true }}
      />,
    );
    expect(screen.getByLabelText('voice_start')).toBeInTheDocument();
  });

  it('clicking the mic button invokes startRecording', () => {
    render(
      <ComposeArea
        ticket={makeTicket()}
        isClosed={false}
        isSupport={true}
        aiConfig={{ voiceTranscription: true }}
      />,
    );
    fireEvent.click(screen.getByLabelText('voice_start'));
    expect(voiceState.startRecording).toHaveBeenCalledTimes(1);
  });

  it('shows the elapsed timer in the recording state', () => {
    voiceState.isRecording = true;
    voiceState.elapsedSec = 23;
    render(
      <ComposeArea
        ticket={makeTicket()}
        isClosed={false}
        isSupport={true}
        aiConfig={{ voiceTranscription: true }}
      />,
    );
    // 23s -> "0:23"
    expect(screen.getByText('0:23')).toBeInTheDocument();
    // Stop affordance available + aria-pressed=true
    const btn = screen.getByLabelText('voice_stop');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the transcribing label and disables the button while in flight', () => {
    voiceState.isTranscribing = true;
    render(
      <ComposeArea
        ticket={makeTicket()}
        isClosed={false}
        isSupport={true}
        aiConfig={{ voiceTranscription: true }}
      />,
    );
    expect(screen.getByText('voice_transcribing')).toBeInTheDocument();
    // The mic button should not be clickable while transcribing.
    const btn = screen.queryByLabelText('voice_start');
    expect(btn === null || (btn as HTMLButtonElement).disabled).toBe(true);
  });
});
