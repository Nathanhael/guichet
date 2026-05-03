import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  auditAiConfigChange,
  buildAiConfigDiff,
  emitAiConfigAudits,
  type AiConfigAuditAction,
} from './auditConfig';

function makeTx() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  return {
    tx: { insert },
    rows: () => values.mock.calls.map((c) => c[0] as Record<string, unknown>),
    getValuesCall: () => values.mock.calls[0]?.[0] as Record<string, unknown> | undefined,
    insertCount: () => insert.mock.calls.length,
  };
}

describe('auditAiConfigChange', () => {
  let h: ReturnType<typeof makeTx>;

  beforeEach(() => {
    h = makeTx();
  });

  it('writes a row with the supplied action and partnerId as targetId', async () => {
    await auditAiConfigChange(h.tx, {
      action: 'ai.enabled_changed',
      actor: { kind: 'user', userId: 'user-1' },
      partnerId: 'partner-1',
      before: { aiEnabled: false },
      after: { aiEnabled: true },
    });

    const row = h.getValuesCall();
    expect(row.action).toBe('ai.enabled_changed');
    expect(row.partnerId).toBe('partner-1');
    expect(row.targetType).toBe('ai_config');
    expect(row.targetId).toBe('partner-1');
  });

  it('records actorId for user actors', async () => {
    await auditAiConfigChange(h.tx, {
      action: 'ai.features_changed',
      actor: { kind: 'user', userId: 'user-42' },
      partnerId: 'partner-1',
      before: { aiEnabled: false },
      after: { aiEnabled: true },
    });
    expect(h.getValuesCall().actorId).toBe('user-42');
  });

  it('records null actorId for system actor', async () => {
    await auditAiConfigChange(h.tx, {
      action: 'ai.features_changed',
      actor: { kind: 'system' },
      partnerId: 'partner-1',
      before: { aiEnabled: false },
      after: { aiEnabled: true },
    });
    expect(h.getValuesCall().actorId).toBeNull();
  });

  it('places before/after diff into metadata', async () => {
    await auditAiConfigChange(h.tx, {
      action: 'ai.model_changed',
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: { aiModel: 'gpt-4o' },
      after: { aiModel: 'gpt-5-mini' },
    });
    const meta = h.getValuesCall().metadata;
    expect(meta.before).toEqual({ aiModel: 'gpt-4o' });
    expect(meta.after).toEqual({ aiModel: 'gpt-5-mini' });
  });

  it('redacts apiKey to last-4 in both before and after', async () => {
    await auditAiConfigChange(h.tx, {
      action: 'ai.api_key_rotated',
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: { apiKey: 'sk-abcdef1234' },
      after: { apiKey: 'sk-newkey5678' },
    });
    const meta = h.getValuesCall().metadata;
    expect(meta.before.apiKey).toBe('****1234');
    expect(meta.after.apiKey).toBe('****5678');
  });

  it('skips the insert entirely when before deep-equals after (no-op guard)', async () => {
    await auditAiConfigChange(h.tx, {
      action: 'ai.enabled_changed',
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: { aiEnabled: true },
      after: { aiEnabled: true },
    });
    expect(h.insertCount()).toBe(0);
  });

  it('accepts every declared AiConfigAuditAction value', async () => {
    const actions: AiConfigAuditAction[] = [
      'ai.enabled_changed',
      'ai.features_changed',
      'ai.provider_changed',
      'ai.model_changed',
      'ai.api_key_rotated',
      'ai.base_url_changed',
      'ai.deployment_changed',
      'ai.terms_changed',
      'ai.custom_instructions_changed',
      'ai.privacy_changed',
    ];
    expect(actions).toHaveLength(10);
    for (const action of actions) {
      const local = makeTx();
      await auditAiConfigChange(local.tx, {
        action,
        actor: { kind: 'user', userId: 'u' },
        partnerId: 'p',
        before: { x: 1 },
        after: { x: 2 },
      });
      expect(local.getValuesCall().action).toBe(action);
    }
  });
});

describe('buildAiConfigDiff', () => {
  it('returns only the keys that actually changed', () => {
    const diff = buildAiConfigDiff(
      { aiEnabled: false, aiModel: 'gpt-4o' },
      { aiEnabled: true, aiModel: 'gpt-4o' },
    );
    expect(diff.before).toEqual({ aiEnabled: false });
    expect(diff.after).toEqual({ aiEnabled: true });
  });

  it('detects deep changes inside aiFeatures JSONB', () => {
    const diff = buildAiConfigDiff(
      { aiFeatures: { translation: false, messageImprovement: 'optional' } },
      { aiFeatures: { translation: true, messageImprovement: 'optional' } },
    );
    expect(diff.before).toEqual({
      aiFeatures: { translation: false, messageImprovement: 'optional' },
    });
    expect(diff.after).toEqual({
      aiFeatures: { translation: true, messageImprovement: 'optional' },
    });
  });

  it('returns empty before/after when nothing changed', () => {
    const diff = buildAiConfigDiff(
      { aiEnabled: true, aiModel: 'gpt-4o' },
      { aiEnabled: true, aiModel: 'gpt-4o' },
    );
    expect(diff.before).toEqual({});
    expect(diff.after).toEqual({});
  });

  it('redacts apiKey to last-4 in the returned diff', () => {
    const diff = buildAiConfigDiff(
      { apiKey: 'sk-old1234' },
      { apiKey: 'sk-new5678' },
    );
    expect(diff.before).toEqual({ apiKey: '****1234' });
    expect(diff.after).toEqual({ apiKey: '****5678' });
  });

  it('redacts apiKey nested under aiConfig', () => {
    const diff = buildAiConfigDiff(
      { aiConfig: { apiKey: 'sk-old1234', baseUrl: 'https://a.example' } },
      { aiConfig: { apiKey: 'sk-new5678', baseUrl: 'https://a.example' } },
    );
    expect((diff.after as { aiConfig: { apiKey: string } }).aiConfig.apiKey).toBe('****5678');
    expect((diff.before as { aiConfig: { apiKey: string } }).aiConfig.apiKey).toBe('****1234');
  });

  it('handles short apiKey strings without crashing', () => {
    const diff = buildAiConfigDiff({ apiKey: 'abc' }, { apiKey: 'xyz' });
    // less than 4 chars — implementation chooses the safest behavior
    expect(typeof (diff.before as { apiKey: string }).apiKey).toBe('string');
    expect(typeof (diff.after as { apiKey: string }).apiKey).toBe('string');
    expect((diff.before as { apiKey: string }).apiKey).not.toBe('abc');
    expect((diff.after as { apiKey: string }).apiKey).not.toBe('xyz');
  });
});

describe('emitAiConfigAudits', () => {
  let h: ReturnType<typeof makeTx>;

  beforeEach(() => {
    h = makeTx();
  });

  function emittedActions(): AiConfigAuditAction[] {
    return h.rows().map((r) => r.action as AiConfigAuditAction);
  }

  it('emits nothing when before deep-equals after', async () => {
    const count = await emitAiConfigAudits(h.tx, {
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: { aiEnabled: true, aiModel: 'gpt-5-mini' },
      after: { aiEnabled: true, aiModel: 'gpt-5-mini' },
    });
    expect(count).toBe(0);
    expect(h.insertCount()).toBe(0);
  });

  it('emits ai.enabled_changed when aiEnabled flipped', async () => {
    await emitAiConfigAudits(h.tx, {
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: { aiEnabled: false },
      after: { aiEnabled: true },
    });
    expect(emittedActions()).toEqual(['ai.enabled_changed']);
  });

  it('emits ai.features_changed when aiFeatures JSONB diverges', async () => {
    await emitAiConfigAudits(h.tx, {
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: { aiFeatures: { translation: false } },
      after: { aiFeatures: { translation: true } },
    });
    expect(emittedActions()).toEqual(['ai.features_changed']);
  });

  it('emits provider, model, base_url, deployment, api_key_rotated when nested aiConfig changes', async () => {
    await emitAiConfigAudits(h.tx, {
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: {
        aiProvider: 'openai-compatible',
        aiModel: 'lmstudio-community/llama3-8b',
        aiConfig: { apiKey: 'sk-old1234', baseUrl: 'https://a', deployment: 'old' },
      },
      after: {
        aiProvider: 'azure-openai',
        aiModel: 'gpt-5-mini',
        aiConfig: { apiKey: 'sk-new5678', baseUrl: 'https://b', deployment: 'new' },
      },
    });
    const actions = emittedActions();
    expect(actions).toContain('ai.provider_changed');
    expect(actions).toContain('ai.model_changed');
    expect(actions).toContain('ai.api_key_rotated');
    expect(actions).toContain('ai.base_url_changed');
    expect(actions).toContain('ai.deployment_changed');
    expect(actions).toHaveLength(5);
  });

  it('redacts apiKey in the api_key_rotated row metadata', async () => {
    await emitAiConfigAudits(h.tx, {
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: { aiConfig: { apiKey: 'sk-old1234' } },
      after: { aiConfig: { apiKey: 'sk-new5678' } },
    });
    const row = h.rows().find((r) => r.action === 'ai.api_key_rotated');
    expect(row).toBeDefined();
    const meta = row!.metadata as { before: { aiConfig: { apiKey: string } }; after: { aiConfig: { apiKey: string } } };
    expect(meta.before.aiConfig.apiKey).toBe('****1234');
    expect(meta.after.aiConfig.apiKey).toBe('****5678');
  });

  it('emits multiple distinct events when several top-level fields change at once', async () => {
    await emitAiConfigAudits(h.tx, {
      actor: { kind: 'user', userId: 'u' },
      partnerId: 'p',
      before: { aiEnabled: false, aiModel: 'gpt-4o' },
      after: { aiEnabled: true, aiModel: 'gpt-5-mini' },
    });
    const actions = emittedActions();
    expect(actions).toContain('ai.enabled_changed');
    expect(actions).toContain('ai.model_changed');
    expect(actions).toHaveLength(2);
  });
});
