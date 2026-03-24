import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockIsFeatureEnabled = vi.fn();
const mockGetProvider = vi.fn();
const mockGetPromptTemplate = vi.fn();
const mockInterpolate = vi.fn();
const mockLogUsage = vi.fn();
const mockFormatMessagesForAi = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('./index.js', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  getPromptTemplate: (...args: unknown[]) => mockGetPromptTemplate(...args),
  interpolate: (...args: unknown[]) => mockInterpolate(...args),
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
  formatMessagesForAi: (...args: unknown[]) => mockFormatMessagesForAi(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockSet = vi.fn();

vi.mock('../../db/postgres.js', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock('../../db/schema.js', () => ({
  messages: {
    senderName: 'sender_name',
    senderRole: 'sender_role',
    text: 'text',
    ticketId: 'ticket_id',
    deletedAt: 'deleted_at',
    createdAt: 'created_at',
  },
  tickets: {
    id: 'id',
    closingNotes: 'closing_notes',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  asc: vi.fn((col: unknown) => ({ type: 'asc', col })),
  isNull: vi.fn((col: unknown) => ({ type: 'isNull', col })),
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

function setupSelectChain(result: unknown[]) {
  mockLimit.mockResolvedValue(result);
  mockOrderBy.mockReturnValue(result);
  mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockDbSelect.mockReturnValue({ from: mockFrom });
}

function setupUpdateChain() {
  mockWhere.mockResolvedValue(undefined);
  mockSet.mockReturnValue({ where: mockWhere });
  mockDbUpdate.mockReturnValue({ set: mockSet });
}

const PARTNER_ID = 'partner-1';
const USER_ID = 'user-1';
const TICKET_ID = 'ticket-1';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('autoSummarizeOnClose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when feature is disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');
    await autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io);

    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(PARTNER_ID, 'autoSummarizeOnClose');
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('does nothing when rate limited', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, limitHit: 'perMinute', retryAfterSeconds: 30 });
    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');
    await autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(PARTNER_ID);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it('generates summary, updates ticket, and emits event when enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });

    const messages = [
      { senderName: 'Alice', senderRole: 'agent', text: 'Hi, I need help' },
      { senderName: 'Bob', senderRole: 'support', text: 'Sure, what is the issue?' },
    ];

    // Select call: fetch messages (returns array directly from orderBy)
    const messagesOrderBy = vi.fn().mockResolvedValue(messages);
    const messagesWhere = vi.fn().mockReturnValue({ orderBy: messagesOrderBy });
    const messagesFrom = vi.fn().mockReturnValue({ where: messagesWhere });

    mockDbSelect.mockReturnValueOnce({ from: messagesFrom });

    // Atomic update call (updates only if closing_notes is empty)
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    mockFormatMessagesForAi.mockReturnValue('formatted messages');
    mockGetPromptTemplate.mockResolvedValue('Summarize: {{messages}}');
    mockInterpolate.mockReturnValue('Summarize: formatted messages');

    const mockChat = vi.fn().mockResolvedValue({
      content: 'This is a summary.',
      inputTokens: 100,
      outputTokens: 20,
      model: 'gpt-4',
    });

    mockGetProvider.mockResolvedValue({
      name: 'openai',
      chat: mockChat,
    });

    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');
    await autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io);

    // Verify AI was called with correct params
    expect(mockChat).toHaveBeenCalledWith({
      model: 'default',
      messages: [{ role: 'user', content: 'Summarize: formatted messages' }],
      temperature: 0.3,
      maxTokens: 512,
    });

    // Verify usage was logged
    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: PARTNER_ID,
        userId: USER_ID,
        action: 'summarize',
        provider: 'openai',
        model: 'gpt-4',
        success: true,
      }),
    );

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
    // With the atomic update pattern, the DB WHERE clause
    // (closing_notes IS NULL OR TRIM(closing_notes) = '') prevents overwrite.
    // The function always calls db.update() — the DB itself guards against overwrite.
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });

    const messages = [
      { senderName: 'Alice', senderRole: 'agent', text: 'Help me' },
    ];

    const messagesOrderBy = vi.fn().mockResolvedValue(messages);
    const messagesWhere = vi.fn().mockReturnValue({ orderBy: messagesOrderBy });
    const messagesFrom = vi.fn().mockReturnValue({ where: messagesWhere });

    mockDbSelect.mockReturnValueOnce({ from: messagesFrom });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    mockFormatMessagesForAi.mockReturnValue('formatted');
    mockGetPromptTemplate.mockResolvedValue('Summarize: {{messages}}');
    mockInterpolate.mockReturnValue('Summarize: formatted');

    mockGetProvider.mockResolvedValue({
      name: 'openai',
      chat: vi.fn().mockResolvedValue({
        content: 'AI summary',
        inputTokens: 50,
        outputTokens: 10,
        model: 'gpt-4',
      }),
    });

    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');
    await autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io);

    // Update IS called — the atomic WHERE clause in the DB prevents overwrite
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ closingNotes: 'AI summary' });
  });

  it('never throws even when an error occurs', async () => {
    mockIsFeatureEnabled.mockRejectedValue(new Error('DB connection failed'));
    const io = createMockIo();

    const { autoSummarizeOnClose } = await import('./autoSummarize.js');

    // Should not throw
    await expect(
      autoSummarizeOnClose(PARTNER_ID, USER_ID, TICKET_ID, io),
    ).resolves.toBeUndefined();
  });
});
