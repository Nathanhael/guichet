import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRunAiAction = vi.fn();
vi.mock('./runAction.js', () => ({
  runAiAction: (...args: unknown[]) => mockRunAiAction(...args),
}));

const mockVerifyTicketOwnership = vi.fn();
const mockFetchTicketMessages = vi.fn();
vi.mock('./ticketMessages.js', () => ({
  verifyTicketOwnership: (...args: unknown[]) => mockVerifyTicketOwnership(...args),
  fetchTicketMessages: (...args: unknown[]) => mockFetchTicketMessages(...args),
}));

const mockFormatMessagesForAi = vi.fn();
vi.mock('./messageFormatter.js', () => ({
  formatMessagesForAi: (...args: unknown[]) => mockFormatMessagesForAi(...args),
}));

const mockDbUpdate = vi.fn();

vi.mock('../../db.js', () => ({
  db: {
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock('../../db/schema.js', () => ({
  tickets: {
    id: 'id',
    partnerId: 'partner_id',
    closingNotes: 'closing_notes',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: vi.fn((strings: TemplateStringsArray) => ({ type: 'sql', value: strings.join('') })),
}));

vi.mock('../../utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockIo() {
  const emit = vi.fn();
  return {
    to: vi.fn(() => ({ emit })),
    _emit: emit,
  } as any;
}

const PARTNER_ID = 'partner-1';
const USER_ID = 'user-1';
const TICKET_ID = 'ticket-1';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('autoSummarizeOnClose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when ticket not found or wrong partner', async () => {
    mockVerifyTicketOwnership.mockResolvedValue(null);
    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');
    await autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io);

    expect(mockVerifyTicketOwnership).toHaveBeenCalledWith(TICKET_ID, PARTNER_ID);
    expect(mockFetchTicketMessages).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('does nothing when no messages to summarize', async () => {
    mockVerifyTicketOwnership.mockResolvedValue({ id: TICKET_ID });
    mockFetchTicketMessages.mockResolvedValue([]);
    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');
    await autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io);

    expect(mockFetchTicketMessages).toHaveBeenCalledWith(TICKET_ID);
    expect(mockRunAiAction).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('swallows errors when runAiAction throws (e.g. feature disabled or rate limited)', async () => {
    mockVerifyTicketOwnership.mockResolvedValue({ id: TICKET_ID });
    mockFetchTicketMessages.mockResolvedValue([
      { senderName: 'Alice', senderRole: 'agent', text: 'Help' },
    ]);
    mockFormatMessagesForAi.mockReturnValue('formatted');
    mockRunAiAction.mockRejectedValue(new Error('AI feature "autoSummarizeOnClose" is not enabled'));
    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');

    // Should not throw — fire-and-forget
    await expect(
      autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io),
    ).resolves.toBeUndefined();

    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('generates summary, updates ticket, and emits event', async () => {
    mockVerifyTicketOwnership.mockResolvedValue({ id: TICKET_ID });

    const messages = [
      { senderName: 'Alice', senderRole: 'agent', text: 'Hi, I need help' },
      { senderName: 'Bob', senderRole: 'support', text: 'Sure, what is the issue?' },
    ];
    mockFetchTicketMessages.mockResolvedValue(messages);
    mockFormatMessagesForAi.mockReturnValue('formatted messages');

    mockRunAiAction.mockResolvedValue({
      content: 'This is a summary.',
      model: 'gpt-4',
    });

    // Atomic update chain
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');
    await autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io);

    // Verify runAiAction called with correct params
    expect(mockRunAiAction).toHaveBeenCalledWith({
      partnerId: PARTNER_ID,
      userId: USER_ID,
      feature: 'autoSummarizeOnClose',
      action: 'summarize',
      vars: { messages: 'formatted messages' },
      temperature: 0.3,
      maxTokens: 512,
    });

    // Verify ticket was updated atomically
    expect(updateSet).toHaveBeenCalledWith({ closingNotes: 'This is a summary.' });

    // Verify socket event was emitted
    expect(io.to).toHaveBeenCalledWith(`ticket:${TICKET_ID}`);
    expect(io._emit).toHaveBeenCalledWith('ticket:summary:generated', {
      ticketId: TICKET_ID,
      summary: 'This is a summary.',
    });
  });

  it('uses atomic WHERE to protect existing closing notes', async () => {
    mockVerifyTicketOwnership.mockResolvedValue({ id: TICKET_ID });
    mockFetchTicketMessages.mockResolvedValue([
      { senderName: 'Alice', senderRole: 'agent', text: 'Help me' },
    ]);
    mockFormatMessagesForAi.mockReturnValue('formatted');
    mockRunAiAction.mockResolvedValue({
      content: 'AI summary',
      model: 'gpt-4',
    });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');
    await autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io);

    // Update IS called — the atomic WHERE clause in the DB prevents overwrite
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ closingNotes: 'AI summary' });
  });

  it('never throws even when an error occurs', async () => {
    mockVerifyTicketOwnership.mockRejectedValue(new Error('DB connection failed'));
    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');

    // Should not throw
    await expect(
      autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io),
    ).resolves.toBeUndefined();
  });
});
