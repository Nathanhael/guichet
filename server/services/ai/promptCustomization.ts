import { eq } from 'drizzle-orm';
import type { AiAction } from './types.js';
import { getAiContext } from './context.js';

interface PartnerTerms {
  preserve?: string[];
  forbidden?: string[];
}

interface PartnerCustomInstructions {
  improve?: string;
  translate?: string;
}

const PRESERVE_RE = /\{\{preserve_terms\}\}/g;
const FORBIDDEN_RE = /\{\{forbidden_terms\}\}/g;

/**
 * Apply partner-level prompt customization on top of an interpolated template:
 *   - Replace `{{preserve_terms}}` and `{{forbidden_terms}}` with comma-joined
 *     glossary lists from `partners.aiTerms` (decision 19).
 *   - Prepend `partners.aiCustomInstructions[action]` when set, separated by a
 *     blank line, so the instruction biases the model BEFORE the standard prompt
 *     (decision 23). Empty string is treated as not set.
 *
 * Falls back to a no-op (returns the input unchanged) when partnerId is undefined,
 * the row is missing, or the DB read errors. Storage of these columns is in
 * migration 0006.
 */
export async function applyPartnerCustomization(
  prompt: string,
  action: AiAction,
  partnerId: string | undefined,
): Promise<string> {
  if (!partnerId) return prompt;

  let terms: PartnerTerms = {};
  let instructions: PartnerCustomInstructions = {};
  try {
    const { db, schema } = getAiContext();
    const { partners } = schema;
    const rows = await db
      .select({
        aiTerms: partners.aiTerms,
        aiCustomInstructions: partners.aiCustomInstructions,
      })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1);

    const row = rows[0];
    if (row) {
      terms = (row.aiTerms ?? {}) as PartnerTerms;
      instructions = (row.aiCustomInstructions ?? {}) as PartnerCustomInstructions;
    }
  } catch {
    return prompt;
  }

  const preserveList = (terms.preserve ?? []).join(', ');
  const forbiddenList = (terms.forbidden ?? []).join(', ');
  let result = prompt.replace(PRESERVE_RE, preserveList).replace(FORBIDDEN_RE, forbiddenList);

  // Custom instructions only apply to the user-facing AI actions.
  if (action === 'improve' || action === 'translate') {
    const prefix = instructions[action];
    if (prefix && prefix.trim().length > 0) {
      result = `${prefix}\n\n${result}`;
    }
  }

  return result;
}
