// Slice 10.5: partner-admin-side mutation to update aiTerms + aiCustomInstructions
// + a getter the AdminAi panel uses to hydrate.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  capturedUpdateSet,
  capturedAuditRows,
  selectResult,
  resetState,
  setSelectResult,
} = vi.hoisted(() => {
  const state = {
    capturedUpdateSet: [] as Array<Record<string, unknown>>,
    capturedAuditRows: [] as Array<Record<string, unknown>>,
    selectResult: [] as Array<Record<string, unknown>>,
  };
  return {
    capturedUpdateSet: state.capturedUpdateSet,
    capturedAuditRows: state.capturedAuditRows,
    selectResult: state.selectResult,
    resetState: () => {
      state.capturedUpdateSet.length = 0;
      state.capturedAuditRows.length = 0;
      state.selectResult.length = 0;
    },
    setSelectResult: (rows: Array<Record<string, unknown>>) => {
      state.selectResult.length = 0;
      state.selectResult.push(...rows);
    },
  };
});

vi.mock('../../../db.js', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          capturedUpdateSet.push(values);
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        capturedAuditRows.push(row);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResult),
        }),
      }),
    }),
  },
}));

vi.mock('../../../services/ai/index.js', () => ({
  getPartnerAiConfig: vi.fn(),
}));

import { partnerConfigRouter } from '../partner/config.js';

type CallerCtx = Parameters<typeof partnerConfigRouter.createCaller>[0];

const adminUser = {
  id: 'u-admin',
  name: 'Admin',
  email: 'admin@test',
  role: 'admin' as const,
  partnerId: 'p-1',
  isPlatformOperator: false,
  lang: 'en' as const,
};

const supportUser = { ...adminUser, id: 'u-support', role: 'support' as const };

function makeCaller(user: typeof adminUser | typeof supportUser = adminUser) {
  return partnerConfigRouter.createCaller({ user } as unknown as CallerCtx);
}

describe('partnerConfigRouter.updateAiCustomization (slice 10.5)', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('updates only aiTerms when only that sub-object is provided', async () => {
    await makeCaller().updateAiCustomization({
      aiTerms: { preserve: ['FTTP', 'MVNO'], forbidden: ['CompetitorX'] },
    });

    expect(capturedUpdateSet).toHaveLength(1);
    const set = capturedUpdateSet[0];
    expect(set.aiTerms).toEqual({ preserve: ['FTTP', 'MVNO'], forbidden: ['CompetitorX'] });
    expect(set.aiCustomInstructions).toBeUndefined();
  });

  it('updates only aiCustomInstructions when only that sub-object is provided', async () => {
    await makeCaller().updateAiCustomization({
      aiCustomInstructions: { improve: 'Use bullet lists for multi-step replies.' },
    });

    expect(capturedUpdateSet).toHaveLength(1);
    const set = capturedUpdateSet[0];
    expect(set.aiCustomInstructions).toEqual({ improve: 'Use bullet lists for multi-step replies.' });
    expect(set.aiTerms).toBeUndefined();
  });

  it('updates both when both sub-objects are provided', async () => {
    await makeCaller().updateAiCustomization({
      aiTerms: { preserve: ['VoIP'], forbidden: [] },
      aiCustomInstructions: { improve: 'Use bullets.', translate: 'Use formal Dutch.' },
    });

    const set = capturedUpdateSet[0];
    expect(set.aiTerms).toBeDefined();
    expect(set.aiCustomInstructions).toBeDefined();
  });

  it('rejects support callers (admin gate)', async () => {
    await expect(
      makeCaller(supportUser).updateAiCustomization({
        aiTerms: { preserve: [], forbidden: [] },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(capturedUpdateSet).toHaveLength(0);
  });

  it('rejects when preserve list exceeds 50 entries', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `term${i}`);
    await expect(
      makeCaller().updateAiCustomization({
        aiTerms: { preserve: tooMany, forbidden: [] },
      }),
    ).rejects.toBeDefined();
    expect(capturedUpdateSet).toHaveLength(0);
  });

  it('rejects when an instruction exceeds 2000 chars', async () => {
    const long = 'x'.repeat(2001);
    await expect(
      makeCaller().updateAiCustomization({
        aiCustomInstructions: { improve: long },
      }),
    ).rejects.toBeDefined();
    expect(capturedUpdateSet).toHaveLength(0);
  });

  it('writes a partner.config_updated audit row scoped to the caller partner', async () => {
    await makeCaller().updateAiCustomization({
      aiTerms: { preserve: ['VoIP'], forbidden: [] },
    });

    expect(capturedAuditRows).toHaveLength(1);
    const row = capturedAuditRows[0];
    expect(row.action).toBe('partner.config_updated');
    expect(row.actorId).toBe('u-admin');
    expect(row.partnerId).toBe('p-1');
    expect(row.targetType).toBe('partner');
    expect(row.targetId).toBe('p-1');
  });
});

describe('partnerConfigRouter.getAiCustomization (slice 10.5)', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('returns empty defaults when partner row has nulls', async () => {
    setSelectResult([{ aiTerms: null, aiCustomInstructions: null }]);
    const result = await makeCaller().getAiCustomization();
    expect(result).toEqual({
      aiTerms: { preserve: [], forbidden: [] },
      aiCustomInstructions: { improve: '', translate: '' },
    });
  });

  it('returns saved values when partner row is populated', async () => {
    setSelectResult([{
      aiTerms: { preserve: ['FTTP'], forbidden: ['oldname'] },
      aiCustomInstructions: { improve: 'use bullets', translate: 'formal Dutch' },
    }]);
    const result = await makeCaller().getAiCustomization();
    expect(result.aiTerms).toEqual({ preserve: ['FTTP'], forbidden: ['oldname'] });
    expect(result.aiCustomInstructions.improve).toBe('use bullets');
    expect(result.aiCustomInstructions.translate).toBe('formal Dutch');
  });

  it('rejects support callers (admin gate)', async () => {
    await expect(
      makeCaller(supportUser).getAiCustomization(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
