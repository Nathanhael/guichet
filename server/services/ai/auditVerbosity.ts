import { eq } from 'drizzle-orm';
import { getAiContext } from './context.js';

export type AuditVerbosity = 'metadata' | 'full';

const DEFAULT: AuditVerbosity = 'metadata';
const PLATFORM_DEFAULT_KEY = 'ai_audit_verbosity_default';

async function readPlatformDefault(): Promise<AuditVerbosity> {
  try {
    const { db, schema } = getAiContext();
    const { systemSettings } = schema;
    if (!systemSettings) return DEFAULT;
    const rows = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, PLATFORM_DEFAULT_KEY))
      .limit(1);
    const raw = rows[0]?.value;
    if (raw === 'full' || raw === 'metadata') return raw;
    return DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/**
 * Resolve the effective AI audit verbosity for a partner.
 * Reads partners.ai_audit_verbosity. NULL or unknown values fall back to the
 * platform default in `system_settings.ai_audit_verbosity_default`; if that
 * is also missing/unknown, falls back to 'metadata' (safest).
 *
 * Per spec decision 22 (stricter-only override): partner can be MORE strict than
 * the platform default, but never less. Stricter-only enforcement happens at
 * write time (admin UI); this read is a simple precedence:
 *   partner override (if set & valid) → platform default (if set & valid) → 'metadata'.
 */
export async function getEffectiveAuditVerbosity(partnerId: string): Promise<AuditVerbosity> {
  try {
    const { db, schema } = getAiContext();
    const { partners } = schema;
    const rows = await db
      .select({ aiAuditVerbosity: partners.aiAuditVerbosity })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1);

    const raw = rows[0]?.aiAuditVerbosity;
    if (raw === 'full' || raw === 'metadata') return raw;
    return await readPlatformDefault();
  } catch {
    return DEFAULT;
  }
}
