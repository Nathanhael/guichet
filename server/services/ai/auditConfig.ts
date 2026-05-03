import { auditLog } from '../../db/schema.js';

export type AiConfigAuditAction =
  | 'ai.enabled_changed'
  | 'ai.features_changed'
  | 'ai.provider_changed'
  | 'ai.model_changed'
  | 'ai.api_key_rotated'
  | 'ai.base_url_changed'
  | 'ai.deployment_changed'
  | 'ai.terms_changed'
  | 'ai.custom_instructions_changed'
  | 'ai.privacy_changed';

type AuditActor = { kind: 'user'; userId: string } | { kind: 'system' };

export interface AuditAiConfigChangeArgs {
  action: AiConfigAuditAction;
  actor: AuditActor;
  partnerId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

// Accept any drizzle-shaped tx/db. Mirrors `writeAudit` in ticketLifecycle/audit.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InsertableTx = any;

function redactKey(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const tail = value.length >= 4 ? value.slice(-4) : value;
  return `****${tail}`;
}

function redactSensitive(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  if ('apiKey' in out) {
    out.apiKey = redactKey(out.apiKey);
  }
  if (out.aiConfig && typeof out.aiConfig === 'object') {
    const cfg = { ...(out.aiConfig as Record<string, unknown>) };
    if ('apiKey' in cfg) cfg.apiKey = redactKey(cfg.apiKey);
    out.aiConfig = cfg;
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

export interface AiConfigDiff {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export function buildAiConfigDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AiConfigDiff {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  for (const key of allKeys) {
    if (!deepEqual(before[key], after[key])) {
      if (key in before) beforeOut[key] = before[key];
      if (key in after) afterOut[key] = after[key];
    }
  }
  return {
    before: redactSensitive(beforeOut),
    after: redactSensitive(afterOut),
  };
}

export async function auditAiConfigChange(
  tx: InsertableTx,
  args: AuditAiConfigChangeArgs,
): Promise<void> {
  if (deepEqual(args.before, args.after)) return;

  await tx.insert(auditLog).values({
    action: args.action,
    actorId: args.actor.kind === 'user' ? args.actor.userId : null,
    partnerId: args.partnerId,
    targetType: 'ai_config',
    targetId: args.partnerId,
    metadata: {
      before: redactSensitive(args.before),
      after: redactSensitive(args.after),
    },
  });
}

export interface EmitAiConfigAuditsArgs {
  actor: AuditActor;
  partnerId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

const TOP_LEVEL_FIELD_TO_ACTION: Record<string, AiConfigAuditAction> = {
  aiEnabled: 'ai.enabled_changed',
  aiFeatures: 'ai.features_changed',
  aiProvider: 'ai.provider_changed',
  aiModel: 'ai.model_changed',
  aiTerms: 'ai.terms_changed',
  aiCustomInstructions: 'ai.custom_instructions_changed',
};

const NESTED_CONFIG_FIELD_TO_ACTION: Record<string, AiConfigAuditAction> = {
  apiKey: 'ai.api_key_rotated',
  baseUrl: 'ai.base_url_changed',
  deployment: 'ai.deployment_changed',
};

const PRIVACY_FIELDS = ['aiPiiRedaction', 'aiAuditVerbosity'] as const;

export async function emitAiConfigAudits(
  tx: InsertableTx,
  args: EmitAiConfigAuditsArgs,
): Promise<number> {
  const { actor, partnerId, before, after } = args;
  let count = 0;

  for (const [field, action] of Object.entries(TOP_LEVEL_FIELD_TO_ACTION)) {
    if (!(field in before) && !(field in after)) continue;
    if (deepEqual(before[field], after[field])) continue;
    await auditAiConfigChange(tx, {
      action,
      actor,
      partnerId,
      before: { [field]: before[field] },
      after: { [field]: after[field] },
    });
    count += 1;
  }

  const beforeCfg = (before.aiConfig as Record<string, unknown> | undefined) ?? {};
  const afterCfg = (after.aiConfig as Record<string, unknown> | undefined) ?? {};
  for (const [field, action] of Object.entries(NESTED_CONFIG_FIELD_TO_ACTION)) {
    if (!(field in beforeCfg) && !(field in afterCfg)) continue;
    if (deepEqual(beforeCfg[field], afterCfg[field])) continue;
    await auditAiConfigChange(tx, {
      action,
      actor,
      partnerId,
      before: { aiConfig: { [field]: beforeCfg[field] } },
      after: { aiConfig: { [field]: afterCfg[field] } },
    });
    count += 1;
  }

  const privacyChanged = PRIVACY_FIELDS.some(
    (f) => (f in before || f in after) && !deepEqual(before[f], after[f]),
  );
  if (privacyChanged) {
    const beforePrivacy: Record<string, unknown> = {};
    const afterPrivacy: Record<string, unknown> = {};
    for (const f of PRIVACY_FIELDS) {
      if (f in before) beforePrivacy[f] = before[f];
      if (f in after) afterPrivacy[f] = after[f];
    }
    await auditAiConfigChange(tx, {
      action: 'ai.privacy_changed',
      actor,
      partnerId,
      before: beforePrivacy,
      after: afterPrivacy,
    });
    count += 1;
  }

  return count;
}
