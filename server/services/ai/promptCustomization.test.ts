// Slice 8.5: partner-level prompt customization. Adds preserve/forbidden terms
// (decision 19) and per-action custom instruction prefix (decision 23) on top
// of the templates returned by getPromptTemplate.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.fn();

vi.mock('./context.js', () => ({
  getAiContext: () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => mockSelect(),
          }),
        }),
      }),
    },
    schema: {
      partners: {
        id: 'partners.id',
        aiTerms: 'partners.ai_terms',
        aiCustomInstructions: 'partners.ai_custom_instructions',
      },
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: {} as never,
    decrypt: (s: string) => s,
  }),
}));

import { applyPartnerCustomization } from './promptCustomization';

const TEMPLATE = 'Improve this:\n{{text}}\nPreserve: {{preserve_terms}}\nForbidden: {{forbidden_terms}}';

describe('applyPartnerCustomization', () => {
  beforeEach(() => {
    mockSelect.mockReset();
  });

  it('returns the prompt unchanged when partnerId is undefined', async () => {
    const result = await applyPartnerCustomization(TEMPLATE, 'improve', undefined);
    expect(result).toBe(TEMPLATE);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('replaces placeholders with empty strings when partner row is missing', async () => {
    mockSelect.mockResolvedValue([]);
    const result = await applyPartnerCustomization(TEMPLATE, 'improve', 'p-1');
    expect(result).toContain('Preserve: \n');
    expect(result).toContain('Forbidden: ');
    expect(result).not.toContain('{{preserve_terms}}');
    expect(result).not.toContain('{{forbidden_terms}}');
  });

  it('returns the prompt unchanged on DB error', async () => {
    mockSelect.mockRejectedValue(new Error('DB down'));
    const result = await applyPartnerCustomization(TEMPLATE, 'improve', 'p-1');
    expect(result).toBe(TEMPLATE);
  });

  it('replaces {{preserve_terms}} with a comma-joined list', async () => {
    mockSelect.mockResolvedValue([
      { aiTerms: { preserve: ['FTTP', 'MVNO', 'DSL'], forbidden: [] }, aiCustomInstructions: {} },
    ]);
    const result = await applyPartnerCustomization(TEMPLATE, 'translate', 'p-1');
    expect(result).toContain('Preserve: FTTP, MVNO, DSL');
  });

  it('replaces {{forbidden_terms}} with a comma-joined list', async () => {
    mockSelect.mockResolvedValue([
      { aiTerms: { preserve: [], forbidden: ['CompetitorX', 'BadWord'] }, aiCustomInstructions: {} },
    ]);
    const result = await applyPartnerCustomization(TEMPLATE, 'translate', 'p-1');
    expect(result).toContain('Forbidden: CompetitorX, BadWord');
  });

  it('replaces both placeholders simultaneously', async () => {
    mockSelect.mockResolvedValue([
      {
        aiTerms: { preserve: ['VoIP'], forbidden: ['oldname'] },
        aiCustomInstructions: {},
      },
    ]);
    const result = await applyPartnerCustomization(TEMPLATE, 'improve', 'p-1');
    expect(result).toContain('Preserve: VoIP');
    expect(result).toContain('Forbidden: oldname');
  });

  it('replaces with empty when partner.aiTerms is null/empty object', async () => {
    mockSelect.mockResolvedValue([{ aiTerms: {}, aiCustomInstructions: {} }]);
    const result = await applyPartnerCustomization(TEMPLATE, 'improve', 'p-1');
    expect(result).toContain('Preserve: \n');
    expect(result).toContain('Forbidden: ');
  });

  it('prepends customInstructions for the matched action with a blank line separator', async () => {
    mockSelect.mockResolvedValue([
      {
        aiTerms: {},
        aiCustomInstructions: { improve: 'Format multi-step replies as numbered lists.' },
      },
    ]);
    const result = await applyPartnerCustomization(TEMPLATE, 'improve', 'p-1');
    expect(result.startsWith('Format multi-step replies as numbered lists.\n\n')).toBe(true);
    expect(result).toContain('Improve this:');
  });

  it('does NOT prepend customInstructions when the action does not match', async () => {
    mockSelect.mockResolvedValue([
      {
        aiTerms: {},
        aiCustomInstructions: { translate: 'Use formal Dutch.' },
      },
    ]);
    const result = await applyPartnerCustomization(TEMPLATE, 'improve', 'p-1');
    expect(result.startsWith('Use formal Dutch')).toBe(false);
    expect(result.startsWith('Improve this:')).toBe(true);
  });

  it('handles terms + customInstructions together in one call', async () => {
    mockSelect.mockResolvedValue([
      {
        aiTerms: { preserve: ['FTTP'], forbidden: ['oldname'] },
        aiCustomInstructions: { translate: 'Use formal Dutch.' },
      },
    ]);
    const result = await applyPartnerCustomization(TEMPLATE, 'translate', 'p-1');
    expect(result.startsWith('Use formal Dutch.\n\n')).toBe(true);
    expect(result).toContain('Preserve: FTTP');
    expect(result).toContain('Forbidden: oldname');
  });

  it('skips empty-string customInstructions (treated as not set)', async () => {
    mockSelect.mockResolvedValue([
      { aiTerms: {}, aiCustomInstructions: { improve: '' } },
    ]);
    const result = await applyPartnerCustomization(TEMPLATE, 'improve', 'p-1');
    expect(result.startsWith('Improve this:')).toBe(true);
  });
});
