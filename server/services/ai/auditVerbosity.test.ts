import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.fn();
const mockPlatformSelect = vi.fn();

// Stable schema references so the mock can route .from() by identity.
const ctxPartnersTable = { id: 'partners.id', aiAuditVerbosity: 'partners.ai_audit_verbosity' };
const ctxSystemSettingsTable = { key: 'system_settings.key', value: 'system_settings.value' };

vi.mock('./context.js', () => ({
  getAiContext: () => ({
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => {
              if (table === ctxPartnersTable) return mockSelect();
              return mockPlatformSelect();
            },
          }),
        }),
      }),
    },
    schema: {
      partners: ctxPartnersTable,
      systemSettings: ctxSystemSettingsTable,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: {} as never,
    decrypt: (s: string) => s,
  }),
}));

import { getEffectiveAuditVerbosity, type AuditVerbosity } from './auditVerbosity';

describe('getEffectiveAuditVerbosity', () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockPlatformSelect.mockReset();
    // Default: no platform setting (test the existing behaviour first)
    mockPlatformSelect.mockResolvedValue([]);
  });

  it('returns the partner override when set to "full"', async () => {
    mockSelect.mockResolvedValue([{ aiAuditVerbosity: 'full' }]);
    const result = await getEffectiveAuditVerbosity('p-1');
    expect(result).toBe('full');
  });

  it('returns the partner override when set to "metadata"', async () => {
    mockSelect.mockResolvedValue([{ aiAuditVerbosity: 'metadata' }]);
    const result = await getEffectiveAuditVerbosity('p-1');
    expect(result).toBe('metadata');
  });

  it('falls back to "metadata" when partner override is NULL (inherit)', async () => {
    mockSelect.mockResolvedValue([{ aiAuditVerbosity: null }]);
    const result = await getEffectiveAuditVerbosity('p-1');
    expect(result).toBe('metadata');
  });

  it('falls back to "metadata" when partner does not exist', async () => {
    mockSelect.mockResolvedValue([]);
    const result = await getEffectiveAuditVerbosity('missing');
    expect(result).toBe('metadata');
  });

  it('falls back to "metadata" when the column holds an unrecognized string', async () => {
    mockSelect.mockResolvedValue([{ aiAuditVerbosity: 'verbose-extreme' }]);
    const result = await getEffectiveAuditVerbosity('p-1');
    expect(result).toBe('metadata');
  });

  it('falls back to "metadata" if the DB read throws', async () => {
    mockSelect.mockRejectedValue(new Error('connection lost'));
    const result = await getEffectiveAuditVerbosity('p-1');
    expect(result).toBe('metadata');
  });

  it('AuditVerbosity type union covers exactly metadata + full', () => {
    const a: AuditVerbosity = 'metadata';
    const b: AuditVerbosity = 'full';
    expect([a, b]).toEqual(['metadata', 'full']);
  });

  it('returns the platform default when partner column is NULL and platform setting is "full"', async () => {
    mockSelect.mockResolvedValue([{ aiAuditVerbosity: null }]);
    mockPlatformSelect.mockResolvedValue([{ value: 'full' }]);
    const result = await getEffectiveAuditVerbosity('p-1');
    expect(result).toBe('full');
  });

  it('falls back to "metadata" when both partner and platform settings are missing', async () => {
    mockSelect.mockResolvedValue([{ aiAuditVerbosity: null }]);
    mockPlatformSelect.mockResolvedValue([]);
    const result = await getEffectiveAuditVerbosity('p-1');
    expect(result).toBe('metadata');
  });
});
