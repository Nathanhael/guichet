/**
 * Platform-level AI security defaults.
 *
 * Slice 10.6 of the AI rollout (decisions 21+22 in the spec). Two global toggles
 * stored in `system_settings`:
 *   - ai_pii_redaction_default     ('on' | 'off')   — defaults to 'on' (safest)
 *   - ai_audit_verbosity_default   ('metadata' | 'full') — defaults to 'metadata'
 *
 * Per-partner overrides are configured in EditPartnerModal but enforced
 * "stricter only" — that write-time enforcement lives in slice 10's partner
 * router, not here. This router only owns the global defaults.
 *
 * Storage convention: `system_settings.value` is JSONB. Existing entries
 * (chain-verify history, last-verify record) store the value directly (no
 * `{ value: … }` wrapper). We follow the same pattern — `value: 'on'` or
 * `value: 'metadata'` — so the JSONB column holds a single quoted string.
 */
import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { systemSettings, auditLog } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const PII_KEY = 'ai_pii_redaction_default';
export const AUDIT_KEY = 'ai_audit_verbosity_default';

type PiiRedaction = 'on' | 'off';
type AuditVerbosity = 'metadata' | 'full';

async function readSetting(key: string): Promise<unknown> {
  const rows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  return rows[0]?.value;
}

function coercePii(raw: unknown): PiiRedaction {
  return raw === 'off' ? 'off' : 'on';
}

function coerceAudit(raw: unknown): AuditVerbosity {
  return raw === 'full' ? 'full' : 'metadata';
}

export const platformSecurityRouter = router({
  getAiSecurityDefaults: platformProcedure.query(async () => {
    const [piiRaw, auditRaw] = await Promise.all([
      readSetting(PII_KEY),
      readSetting(AUDIT_KEY),
    ]);
    return {
      piiRedaction: coercePii(piiRaw),
      auditVerbosity: coerceAudit(auditRaw),
    };
  }),

  setAiSecurityDefaults: platformProcedure
    .input(
      z.object({
        piiRedaction: z.enum(['on', 'off']),
        auditVerbosity: z.enum(['metadata', 'full']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Read BEFORE values so we can write a meaningful diff.
      const [piiBefore, auditBefore] = await Promise.all([
        readSetting(PII_KEY),
        readSetting(AUDIT_KEY),
      ]);
      const before = {
        piiRedaction: coercePii(piiBefore),
        auditVerbosity: coerceAudit(auditBefore),
      };
      const after = {
        piiRedaction: input.piiRedaction,
        auditVerbosity: input.auditVerbosity,
      };

      // Upsert both keys. system_settings.key is the PK so onConflict targets it.
      const now = new Date().toISOString();
      await db
        .insert(systemSettings)
        .values({ key: PII_KEY, value: input.piiRedaction })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: input.piiRedaction, updatedAt: now },
        });
      await db
        .insert(systemSettings)
        .values({ key: AUDIT_KEY, value: input.auditVerbosity })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: input.auditVerbosity, updatedAt: now },
        });

      // Audit the change (always — even if nothing actually moved, an operator
      // pressing Save is a security-relevant intent and should be visible).
      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'platform.ai_security_updated',
        actorId: ctx.user.id,
        targetType: 'system',
        targetId: 'ai_security_defaults',
        metadata: { before, after },
      });

      return { ok: true as const };
    }),
});
