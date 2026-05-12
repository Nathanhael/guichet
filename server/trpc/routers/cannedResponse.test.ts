/**
 * Behavior tests for the cannedResponse tRPC router. Verifies the
 * cannedTranslation feature gate + the source-edit "stale" semantics +
 * the picker's lang resolution.
 *
 * The router uses the singleton `db` import + the `cannedTranslation`
 * service. Both are mocked here so the test isolates router logic from
 * provider/DB infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface CannedRow {
  id: string;
  partnerId: string;
  dept: string | null;
  title: string;
  body: string;
  shortcut: string | null;
  sourceLang: string;
  bodyTranslations: Record<string, string>;
  staleTranslations: Record<string, boolean>;
}

interface TicketRow {
  id: string;
  partnerId: string;
  agentLang: string | null;
}

const h = vi.hoisted(() => {
  const dbState = {
    canneds: [] as CannedRow[],
    tickets: [] as TicketRow[],
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<Record<string, unknown>>,
  };

  function tableNameOf(tableObj: unknown): string {
    if (typeof tableObj !== 'object' || tableObj === null) return 'unknown';
    const t = tableObj as Record<string, unknown> & { _?: { name?: string } };
    if (typeof t._?.name === 'string') return t._.name;
    const sym = (tableObj as Record<symbol, unknown>)[Symbol.for('drizzle:Name')];
    if (typeof sym === 'string') return sym;
    return 'unknown';
  }

  // Tagged builder so the test can identify which table is being queried.
  function buildSelect(cols: unknown) {
    return {
      from: (tableObj: unknown) => {
        const tableName = tableNameOf(tableObj);
        function list(): unknown[] {
          if (tableName === 'canned_responses') {
            if (typeof cols === 'object' && cols !== null && 'id' in cols && Object.keys(cols).length === 1) {
              return dbState.canneds.map((r) => ({ id: r.id }));
            }
            return dbState.canneds;
          }
          if (tableName === 'tickets') return dbState.tickets;
          return [];
        }
        const builder: Record<string | symbol, unknown> = {
          where: () => proxy,
          orderBy: () => list(),
          limit: () => list().slice(0, 1),
        };
        // Allow `await db.select(...).from(...).where(...)` (no orderBy/limit) —
        // the builder is also a thenable that resolves to the rows list.
        const proxy: typeof builder = new Proxy(builder, {
          get(target, prop) {
            if (prop === 'then') {
              const promise = Promise.resolve(list());
              return promise.then.bind(promise);
            }
            return target[prop];
          },
        });
        return proxy;
      },
    };
  }

  const mockDb = {
    select: (cols: unknown) => buildSelect(cols),
    insert: (tableObj: unknown) => {
      const tableName = tableNameOf(tableObj);
      return {
        values: (vals: Record<string, unknown>) => {
          dbState.inserts.push({ table: tableName, values: vals });
          return Promise.resolve();
        },
      };
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          dbState.updates.push(vals);
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  };
  return {
    dbState,
    mockDb,
    mockTranslateCanned: vi.fn(),
    mockIsCannedTranslationEnabled: vi.fn(),
  };
});

vi.mock('../../db.js', () => ({
  db: h.mockDb,
}));

vi.mock('../../services/ai/cannedTranslation.js', () => ({
  translateCanned: (...args: unknown[]) => h.mockTranslateCanned(...args),
  isCannedTranslationEnabled: (...args: unknown[]) => h.mockIsCannedTranslationEnabled(...args),
  ALL_LANGS: ['nl', 'fr', 'en'] as const,
}));

vi.mock('../../services/roles.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/roles.js')>();
  return {
    ...actual,
    canUseSupportWorkflows: () => true,
  };
});

import { cannedResponseRouter } from './cannedResponse.js';

type CallerCtx = Parameters<typeof cannedResponseRouter.createCaller>[0];

function caller(role: 'admin' | 'support' = 'admin') {
  return cannedResponseRouter.createCaller({
    user: {
      id: 'user-1',
      partnerId: 'p1',
      role,
      isPlatformOperator: false,
      departments: [],
    },
  } as unknown as CallerCtx);
}

function seedCanned(over: Partial<CannedRow> = {}): CannedRow {
  const row: CannedRow = {
    id: over.id ?? 'c1',
    partnerId: over.partnerId ?? 'p1',
    dept: over.dept ?? null,
    title: over.title ?? 'Greeting',
    body: over.body ?? 'Hello',
    shortcut: over.shortcut ?? null,
    sourceLang: over.sourceLang ?? 'en',
    bodyTranslations: over.bodyTranslations ?? {},
    staleTranslations: over.staleTranslations ?? {},
  };
  h.dbState.canneds.push(row);
  return row;
}

function seedTicket(over: Partial<TicketRow> = {}): TicketRow {
  const row: TicketRow = {
    id: over.id ?? 't1',
    partnerId: over.partnerId ?? 'p1',
    agentLang: over.agentLang ?? 'en',
  };
  h.dbState.tickets.push(row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.dbState.canneds = [];
  h.dbState.tickets = [];
  h.dbState.inserts = [];
  h.dbState.updates = [];
});

describe('cannedResponse.create', () => {
  it('skips translation entirely when cannedTranslation is OFF', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(false);

    const out = await caller().create({
      title: 'Greeting',
      body: 'Hello there',
      sourceLang: 'en',
    });

    expect(h.mockTranslateCanned).not.toHaveBeenCalled();
    const insert = h.dbState.inserts.find((i) => i.table === 'canned_responses');
    expect(insert?.values).toMatchObject({
      title: 'Greeting',
      body: 'Hello there',
      sourceLang: 'en',
      bodyTranslations: {},
      staleTranslations: {},
    });
    expect(out.bodyTranslations).toEqual({});
  });

  it('calls translateCanned with body+sourceLang when feature is ON', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    h.mockTranslateCanned.mockResolvedValue({ nl: 'Hallo', fr: 'Bonjour' });

    const out = await caller().create({
      title: 'Greeting',
      body: 'Hello there',
      sourceLang: 'en',
    });

    expect(h.mockTranslateCanned).toHaveBeenCalledTimes(1);
    expect(h.mockTranslateCanned).toHaveBeenCalledWith('p1', 'user-1', 'Hello there', 'en');
    const insert = h.dbState.inserts.find((i) => i.table === 'canned_responses');
    expect(insert?.values.bodyTranslations).toEqual({ nl: 'Hallo', fr: 'Bonjour' });
    expect(out.bodyTranslations).toEqual({ nl: 'Hallo', fr: 'Bonjour' });
  });

  it('saves canned with empty translations when service returns {} (graceful AI failure)', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    h.mockTranslateCanned.mockResolvedValue({});

    const out = await caller().create({
      title: 'Greeting',
      body: 'Hello there',
    });

    const insert = h.dbState.inserts.find((i) => i.table === 'canned_responses');
    expect(insert?.values.body).toBe('Hello there');
    expect(insert?.values.bodyTranslations).toEqual({});
    expect(out.bodyTranslations).toEqual({});
  });

  it('defaults sourceLang to "en" when omitted', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(false);

    await caller().create({ title: 'X', body: 'Y' });

    const insert = h.dbState.inserts.find((i) => i.table === 'canned_responses');
    expect(insert?.values.sourceLang).toBe('en');
  });
});

describe('cannedResponse.update', () => {
  beforeEach(() => {
    seedCanned({
      body: 'Original body',
      sourceLang: 'en',
      bodyTranslations: { nl: 'Originele tekst', fr: 'Texte original' },
    });
  });

  it('marks every existing translation stale when body changes', async () => {
    await caller().update({ id: 'c1', body: 'Edited body' });

    expect(h.dbState.updates).toHaveLength(1);
    expect(h.dbState.updates[0]).toMatchObject({
      body: 'Edited body',
      staleTranslations: { nl: true, fr: true },
    });
  });

  it('leaves staleTranslations untouched when body did NOT change', async () => {
    await caller().update({ id: 'c1', title: 'Renamed' });

    expect(h.dbState.updates[0]).not.toHaveProperty('staleTranslations');
    expect(h.dbState.updates[0]).toMatchObject({ title: 'Renamed' });
  });

  it('does not mark stale when body field is supplied but identical to existing', async () => {
    await caller().update({ id: 'c1', body: 'Original body' });

    expect(h.dbState.updates[0]).not.toHaveProperty('staleTranslations');
  });

  it('clears per-lang stale flag and persists translation when admin manually edits one lang', async () => {
    h.dbState.canneds = [];
    seedCanned({
      body: 'Original body',
      sourceLang: 'en',
      bodyTranslations: { nl: 'oude', fr: 'ancien' },
      staleTranslations: { nl: true, fr: true },
    });

    await caller().update({ id: 'c1', bodyTranslations: { nl: 'manueel bewerkt' } });

    expect(h.dbState.updates[0]).toMatchObject({
      bodyTranslations: { nl: 'manueel bewerkt' },
      staleTranslations: { fr: true },
    });
  });

  it('treats an empty bodyTranslations object as no patch (no DB write for that column)', async () => {
    h.dbState.canneds = [];
    seedCanned({
      body: 'Original',
      sourceLang: 'en',
      bodyTranslations: { nl: 'Hallo', fr: 'Bonjour' },
      staleTranslations: { nl: true },
    });

    await caller().update({ id: 'c1', title: 'Renamed', bodyTranslations: {} });

    expect(h.dbState.updates[0]).toMatchObject({ title: 'Renamed' });
    expect(h.dbState.updates[0]).not.toHaveProperty('bodyTranslations');
    expect(h.dbState.updates[0]).not.toHaveProperty('staleTranslations');
  });

  it('strips the orphan body_translations entry when sourceLang flips to that lang', async () => {
    h.dbState.canneds = [];
    seedCanned({
      body: 'Hello',
      sourceLang: 'en',
      bodyTranslations: { nl: 'Hallo', fr: 'Bonjour' },
      staleTranslations: { nl: true },
    });

    await caller().update({ id: 'c1', sourceLang: 'nl' });

    const next = h.dbState.updates[0].bodyTranslations as Record<string, string>;
    expect(next.nl).toBeUndefined();
    expect(next.fr).toBe('Bonjour');
    // Stale flag for nl is dropped because the entry it pointed at is gone.
    expect((h.dbState.updates[0].staleTranslations as Record<string, boolean>).nl).toBeUndefined();
    expect(h.dbState.updates[0].sourceLang).toBe('nl');
  });

  it('does not write body_translations when sourceLang flips to a lang that has no entry', async () => {
    h.dbState.canneds = [];
    seedCanned({
      body: 'Hello',
      sourceLang: 'en',
      bodyTranslations: { fr: 'Bonjour' },
    });

    // sourceLang flips to nl, but there's no body_translations.nl to strip.
    await caller().update({ id: 'c1', sourceLang: 'nl' });

    expect(h.dbState.updates[0].sourceLang).toBe('nl');
    // The block stays cold — no body_translations / staleTranslations write.
    expect(h.dbState.updates[0]).not.toHaveProperty('bodyTranslations');
    expect(h.dbState.updates[0]).not.toHaveProperty('staleTranslations');
  });

  it('drops empty-string translation entries when admin clears a lang', async () => {
    h.dbState.canneds = [];
    seedCanned({
      body: 'Original body',
      sourceLang: 'en',
      bodyTranslations: { nl: 'a', fr: 'b' },
      staleTranslations: { nl: true, fr: true },
    });

    await caller().update({ id: 'c1', bodyTranslations: { nl: '', fr: 'kept' } });

    expect((h.dbState.updates[0].bodyTranslations as Record<string, string>).nl).toBeUndefined();
    expect((h.dbState.updates[0].bodyTranslations as Record<string, string>).fr).toBe('kept');
    // Stale flag on nl is dropped because the translation entry is gone.
    expect((h.dbState.updates[0].staleTranslations as Record<string, boolean>).nl).toBeUndefined();
    // Stale flag on fr is cleared because admin manually wrote it.
    expect((h.dbState.updates[0].staleTranslations as Record<string, boolean>).fr).toBeUndefined();
  });
});

describe('cannedResponse.regenerate', () => {
  beforeEach(() => {
    seedCanned({
      body: 'Hello',
      sourceLang: 'en',
      bodyTranslations: { nl: 'oude tekst', fr: 'ancien texte' },
      staleTranslations: { nl: true, fr: true },
    });
  });

  it('throws FORBIDDEN when feature is OFF', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(false);

    await expect(caller().regenerate({ id: 'c1' })).rejects.toThrow(/not enabled/i);
    expect(h.mockTranslateCanned).not.toHaveBeenCalled();
  });

  it('regenerates only stale languages by default and clears stale flags', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    h.mockTranslateCanned.mockResolvedValue({ nl: 'nieuwe tekst', fr: 'nouveau texte' });

    const result = await caller().regenerate({ id: 'c1' });

    expect(h.mockTranslateCanned).toHaveBeenCalledWith('p1', 'user-1', 'Hello', 'en', ['nl', 'fr']);
    expect(h.dbState.updates[0]).toMatchObject({
      bodyTranslations: { nl: 'nieuwe tekst', fr: 'nouveau texte' },
      staleTranslations: {},
    });
    expect(result.translated).toEqual(['nl', 'fr']);
  });

  it('regenerates only listed languages when langs is provided', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    h.mockTranslateCanned.mockResolvedValue({ fr: 'nouveau texte' });

    await caller().regenerate({ id: 'c1', langs: ['fr'] });

    expect(h.mockTranslateCanned).toHaveBeenCalledWith('p1', 'user-1', 'Hello', 'en', ['fr']);
    expect(h.dbState.updates[0].staleTranslations).toEqual({ nl: true });
    expect((h.dbState.updates[0].bodyTranslations as Record<string, string>).fr).toBe('nouveau texte');
    expect((h.dbState.updates[0].bodyTranslations as Record<string, string>).nl).toBe('oude tekst');
  });

  it('drops sourceLang from langs when caller asks for it', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    h.mockTranslateCanned.mockResolvedValue({ nl: 'x' });

    await caller().regenerate({ id: 'c1', langs: ['en', 'nl'] });

    expect(h.mockTranslateCanned).toHaveBeenCalledWith('p1', 'user-1', 'Hello', 'en', ['nl']);
  });

  it('skips translateCanned and returns empty when targets list is empty', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);

    const result = await caller().regenerate({ id: 'c1', langs: ['en'] });

    expect(h.mockTranslateCanned).not.toHaveBeenCalled();
    expect(result.translated).toEqual([]);
  });
});

describe('cannedResponse.backfillUntranslated', () => {
  it('throws FORBIDDEN when feature is OFF', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(false);

    await expect(caller().backfillUntranslated()).rejects.toThrow(/not enabled/i);
    expect(h.mockTranslateCanned).not.toHaveBeenCalled();
  });

  it('translates only the canneds whose bodyTranslations is empty', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    h.mockTranslateCanned.mockResolvedValue({ nl: 'Hallo', fr: 'Bonjour' });

    seedCanned({ id: 'a', body: 'A', sourceLang: 'en', bodyTranslations: {} });
    seedCanned({ id: 'b', body: 'B', sourceLang: 'en', bodyTranslations: {} });
    seedCanned({ id: 'c', body: 'C', sourceLang: 'en', bodyTranslations: { nl: 'already', fr: 'déjà' } });

    const result = await caller().backfillUntranslated();

    expect(h.mockTranslateCanned).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ attempted: 2, translated: 2 });
    expect(h.dbState.updates).toHaveLength(2);
    for (const u of h.dbState.updates) {
      expect(u.bodyTranslations).toEqual({ nl: 'Hallo', fr: 'Bonjour' });
      expect(u.staleTranslations).toEqual({});
    }
  });

  it('skips per-row writes when translateCanned returns empty (graceful AI failure)', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    h.mockTranslateCanned.mockResolvedValue({});

    seedCanned({ id: 'a', body: 'A', sourceLang: 'en', bodyTranslations: {} });
    seedCanned({ id: 'b', body: 'B', sourceLang: 'en', bodyTranslations: {} });

    const result = await caller().backfillUntranslated();

    expect(result).toEqual({ attempted: 2, translated: 0 });
    expect(h.dbState.updates).toHaveLength(0);
  });

  it('returns zero counts when all canneds already have translations', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);

    seedCanned({ id: 'a', bodyTranslations: { nl: 'x' } });
    seedCanned({ id: 'b', bodyTranslations: { fr: 'y' } });

    const result = await caller().backfillUntranslated();

    expect(result).toEqual({ attempted: 0, translated: 0 });
    expect(h.mockTranslateCanned).not.toHaveBeenCalled();
  });
});

describe('cannedResponse.getForPicker', () => {
  it('returns the NL translation when feature is ON, recipient is NL, and translation exists', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    seedTicket({ agentLang: 'nl' });
    seedCanned({
      sourceLang: 'en',
      body: 'Hello',
      bodyTranslations: { nl: 'Hallo', fr: 'Bonjour' },
    });

    const out = await caller('support').getForPicker({ ticketId: 't1' });

    expect(out).toHaveLength(1);
    expect(out[0].body).toBe('Hallo');
  });

  it('falls back to source body when feature is ON but the translation is missing', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    seedTicket({ agentLang: 'fr' });
    seedCanned({
      sourceLang: 'en',
      body: 'Hello',
      bodyTranslations: { nl: 'Hallo' },
    });

    const out = await caller('support').getForPicker({ ticketId: 't1' });

    expect(out[0].body).toBe('Hello');
  });

  it('falls back to source body when feature is ON but recipient lang equals source', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    seedTicket({ agentLang: 'en' });
    seedCanned({
      sourceLang: 'en',
      body: 'Hello',
      bodyTranslations: { nl: 'Hallo' },
    });

    const out = await caller('support').getForPicker({ ticketId: 't1' });

    expect(out[0].body).toBe('Hello');
  });

  it('always returns source body when feature is OFF', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(false);
    seedTicket({ agentLang: 'nl' });
    seedCanned({
      sourceLang: 'en',
      body: 'Hello',
      bodyTranslations: { nl: 'Hallo' },
    });

    const out = await caller('support').getForPicker({ ticketId: 't1' });

    expect(out[0].body).toBe('Hello');
  });

  it('returns empty array when ticket is not found', async () => {
    h.mockIsCannedTranslationEnabled.mockResolvedValue(true);
    seedCanned({ body: 'Hello' });
    // no seedTicket — ticket lookup returns []

    const out = await caller('support').getForPicker({ ticketId: 't-missing' });

    expect(out).toEqual([]);
  });
});
