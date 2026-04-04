import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';

/* ── DB mock ─────────────────────────────────────────────────────────── */

const selectQueue: unknown[] = [];
const insertValuesMock = vi.fn();

const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => selectQueue.shift() ?? []),
    })),
  })),
  insert: vi.fn(() => ({
    values: insertValuesMock,
  })),
};

vi.mock('../db.js', () => ({
  db: dbMock,
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/* ── DNS mock ────────────────────────────────────────────────────────── */

vi.mock('dns', () => ({
  default: {
    promises: {
      lookup: vi.fn(async () => ({ address: '93.184.216.34', family: 4 })),
    },
  },
}));

/* ── Fetch mock ──────────────────────────────────────────────────────── */

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', fetchMock);

/* ── Helpers ─────────────────────────────────────────────────────────── */

function makeHook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wh-1',
    partnerId: 'partner-1',
    url: 'https://example.com/hook',
    secret: 'test-secret-key',
    events: ['ticket.created', 'ticket.closed'],
    description: 'Test webhook',
    active: true,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function okResponse(body = 'OK'): Response {
  return new Response(body, { status: 200, statusText: 'OK' });
}

function errorResponse(status = 500, body = 'Internal Server Error'): Response {
  return new Response(body, { status, statusText: 'Error' });
}

/* ── Reset state ─────────────────────────────────────────────────────── */

beforeEach(() => {
  selectQueue.length = 0;
  dbMock.select.mockClear();
  dbMock.insert.mockClear();
  insertValuesMock.mockReset();
  insertValuesMock.mockResolvedValue(undefined);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okResponse());
});

/* ── Tests ────────────────────────────────────────────────────────────── */

describe('fireWebhooks', () => {
  it('dispatches to matching webhooks and logs delivery', async () => {
    const hook = makeHook();
    selectQueue.push([hook]);

    const { fireWebhooks } = await import('./webhookDispatch.js');
    // fireWebhooks is fire-and-forget; we need to wait for the internal promise
    // The simplest approach: call the function and flush microtasks
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    // Allow all internal promises to settle
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Verify the POST was made with correct headers
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Tessera-Event']).toBe('ticket.created');
    expect(headers['X-Tessera-Signature']).toBeDefined();
    expect(headers['User-Agent']).toBe('Tessera-Webhook/1.0');
    expect(headers['Host']).toBe('example.com');

    // Verify delivery log was inserted
    await vi.waitFor(() => {
      expect(insertValuesMock).toHaveBeenCalledTimes(1);
    });
    const logEntry = insertValuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(logEntry).toMatchObject({
      webhookId: 'wh-1',
      event: 'ticket.created',
      statusCode: 200,
    });
  });

  it('skips webhooks not subscribed to the event', async () => {
    const hook = makeHook({ events: ['rating.submitted'] });
    selectQueue.push([hook]);

    const { fireWebhooks } = await import('./webhookDispatch.js');
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    // Give time for the async dispatch
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatches to wildcard (*) subscribers', async () => {
    const hook = makeHook({ events: ['*'] });
    selectQueue.push([hook]);

    const { fireWebhooks } = await import('./webhookDispatch.js');
    fireWebhooks('partner-1', 'message.created', { messageId: 'm-1' });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('does nothing when no active webhooks exist', async () => {
    selectQueue.push([]);

    const { fireWebhooks } = await import('./webhookDispatch.js');
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('dispatches to multiple matching webhooks in parallel', async () => {
    const hook1 = makeHook({ id: 'wh-1' });
    const hook2 = makeHook({ id: 'wh-2', url: 'https://other.com/hook', secret: 'other-secret' });
    selectQueue.push([hook1, hook2]);

    const { fireWebhooks } = await import('./webhookDispatch.js');
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    await vi.waitFor(() => {
      expect(insertValuesMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe('HMAC signature', () => {
  it('generates correct HMAC-SHA256 signature in X-Tessera-Signature header', async () => {
    const hook = makeHook();
    selectQueue.push([hook]);

    const { fireWebhooks } = await import('./webhookDispatch.js');
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = init?.body as string;
    const headers = init?.headers as Record<string, string>;
    const receivedSig = headers['X-Tessera-Signature'];

    // Recompute the expected signature
    const expectedSig = createHmac('sha256', 'test-secret-key')
      .update(sentBody)
      .digest('hex');

    expect(receivedSig).toBe(expectedSig);
  });

  it('includes event, data, and timestamp in the signed payload', async () => {
    const hook = makeHook();
    selectQueue.push([hook]);

    const { fireWebhooks } = await import('./webhookDispatch.js');
    fireWebhooks('partner-1', 'ticket.closed', { ticketId: 't-2' });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, init] = fetchMock.mock.calls[0];
    const parsed = JSON.parse(init?.body as string) as Record<string, unknown>;

    expect(parsed.event).toBe('ticket.closed');
    expect(parsed.data).toEqual({ ticketId: 't-2' });
    expect(typeof parsed.timestamp).toBe('string');
  });
});

describe('error handling', () => {
  it('logs delivery failure on network error without throwing', async () => {
    const hook = makeHook();
    selectQueue.push([hook]);
    fetchMock.mockRejectedValue(new Error('Network unreachable'));

    const { fireWebhooks } = await import('./webhookDispatch.js');
    // Should not throw
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    await vi.waitFor(() => {
      expect(insertValuesMock).toHaveBeenCalledTimes(1);
    });

    const logEntry = insertValuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(logEntry).toMatchObject({
      webhookId: 'wh-1',
      event: 'ticket.created',
      error: 'Network unreachable',
    });
    expect(logEntry.statusCode).toBeUndefined();
  });

  it('logs non-2xx response with status code', async () => {
    const hook = makeHook();
    selectQueue.push([hook]);
    fetchMock.mockResolvedValue(errorResponse(502, 'Bad Gateway'));

    const { fireWebhooks } = await import('./webhookDispatch.js');
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    await vi.waitFor(() => {
      expect(insertValuesMock).toHaveBeenCalledTimes(1);
    });

    const logEntry = insertValuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(logEntry).toMatchObject({
      webhookId: 'wh-1',
      event: 'ticket.created',
      statusCode: 502,
    });
  });

  it('caps logged response body at 2000 characters', async () => {
    const hook = makeHook();
    selectQueue.push([hook]);
    const longBody = 'x'.repeat(5000);
    fetchMock.mockResolvedValue(new Response(longBody, { status: 200 }));

    const { fireWebhooks } = await import('./webhookDispatch.js');
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    await vi.waitFor(() => {
      expect(insertValuesMock).toHaveBeenCalledTimes(1);
    });

    const logEntry = insertValuesMock.mock.calls[0][0] as Record<string, unknown>;
    expect((logEntry.responseBody as string).length).toBeLessThanOrEqual(2000);
  });

  it('survives log insertion failure on error path', async () => {
    const hook = makeHook();
    selectQueue.push([hook]);
    fetchMock.mockRejectedValue(new Error('Timeout'));
    // Make the error-path log insertion also fail
    insertValuesMock.mockRejectedValue(new Error('DB write failed'));

    const { fireWebhooks } = await import('./webhookDispatch.js');
    // Should not throw even when logging fails
    fireWebhooks('partner-1', 'ticket.created', { ticketId: 't-1' });

    // Give time for all promises to settle
    await new Promise((r) => setTimeout(r, 100));

    // If we get here without an unhandled rejection, the test passes
    expect(insertValuesMock).toHaveBeenCalled();
  });
});

describe('deliverWebhookTest', () => {
  it('delivers to a single specific webhook', async () => {
    const hook = makeHook();

    const { deliverWebhookTest } = await import('./webhookDispatch.js');
    deliverWebhookTest(hook as Parameters<typeof deliverWebhookTest>[0], 'ticket.created', { test: true });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Should not query the DB for webhooks — it uses the provided hook directly
    expect(dbMock.select).not.toHaveBeenCalled();
  });
});

describe('validateWebhookUrl', () => {
  it('rejects non-HTTPS URLs in non-development mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const { validateWebhookUrl } = await import('./webhookDispatch.js');
      await expect(validateWebhookUrl('http://example.com/hook')).rejects.toThrow(
        'Webhook URL must use HTTPS',
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('rejects URLs resolving to private IP addresses', async () => {
    const dns = await import('dns');
    vi.mocked(dns.default.promises.lookup).mockResolvedValueOnce({
      address: '192.168.1.1',
      family: 4,
    });

    const { validateWebhookUrl } = await import('./webhookDispatch.js');
    await expect(validateWebhookUrl('https://internal.example.com/hook')).rejects.toThrow(
      'private or reserved IP',
    );
  });

  it('rejects URLs resolving to loopback addresses', async () => {
    const dns = await import('dns');
    vi.mocked(dns.default.promises.lookup).mockResolvedValueOnce({
      address: '127.0.0.1',
      family: 4,
    });

    const { validateWebhookUrl } = await import('./webhookDispatch.js');
    await expect(validateWebhookUrl('https://localhost/hook')).rejects.toThrow(
      'private or reserved IP',
    );
  });

  it('returns resolved IP and original hostname for valid URLs', async () => {
    const dns = await import('dns');
    vi.mocked(dns.default.promises.lookup).mockResolvedValueOnce({
      address: '93.184.216.34',
      family: 4,
    });

    const { validateWebhookUrl } = await import('./webhookDispatch.js');
    const result = await validateWebhookUrl('https://example.com/hook');

    expect(result).toEqual({
      resolvedIp: '93.184.216.34',
      originalHostname: 'example.com',
    });
  });
});

describe('isPrivateOrReservedIP', () => {
  it('returns true for private IP hostname', async () => {
    const dns = await import('dns');
    vi.mocked(dns.default.promises.lookup).mockResolvedValueOnce({
      address: '10.0.0.1',
      family: 4,
    });

    const { isPrivateOrReservedIP } = await import('./webhookDispatch.js');
    const result = await isPrivateOrReservedIP('internal.local');
    expect(result).toBe(true);
  });

  it('returns false for public IP hostname', async () => {
    const dns = await import('dns');
    vi.mocked(dns.default.promises.lookup).mockResolvedValueOnce({
      address: '93.184.216.34',
      family: 4,
    });

    const { isPrivateOrReservedIP } = await import('./webhookDispatch.js');
    const result = await isPrivateOrReservedIP('example.com');
    expect(result).toBe(false);
  });

  it('returns true for link-local addresses (169.254.x.x)', async () => {
    const dns = await import('dns');
    vi.mocked(dns.default.promises.lookup).mockResolvedValueOnce({
      address: '169.254.169.254',
      family: 4,
    });

    const { isPrivateOrReservedIP } = await import('./webhookDispatch.js');
    const result = await isPrivateOrReservedIP('metadata.internal');
    expect(result).toBe(true);
  });
});
