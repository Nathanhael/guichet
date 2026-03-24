import { db } from '../../db/postgres.js';
import { aiPromptTemplates } from '../../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { AiAction } from './types.js';

// ─── Built-in Default Prompts ───────────────────────────────────────────────

const DEFAULTS: Record<AiAction, string> = {
  classify: `Classify the following support message into one of these categories: {{categories}}.
Reply with ONLY the category name, nothing else.

Message: {{text}}`,

  suggest: `You are a helpful support assistant. Based on the conversation below, suggest a professional and clear reply for the support agent to send.

Conversation:
{{messages}}

Suggested reply:`,

  summarize: `Summarize this support conversation in 2-3 sentences. Include: the problem reported, what has been tried, and the current status.

Conversation:
{{messages}}`,

  improve: `Rewrite the following message to be clearer, more professional, and well-structured. Keep the same meaning and tone. Do not add information that wasn't in the original.

Original message:
{{text}}

Improved message:`,

  translate: `Translate the following text to {{targetLang}}. Preserve the tone and meaning. Reply with ONLY the translation, nothing else.

Text: {{text}}`,

  sentiment: `Analyze the sentiment of this message on a scale from -1.0 (very negative) to 1.0 (very positive). Reply with ONLY a number, nothing else.

Message: {{text}}`,

  match_canned: `Given these canned responses:
{{responses}}

And this customer message:
{{text}}

Which canned response best matches? Reply with ONLY the response ID, or "none" if no good match.`,
};

/**
 * Get the prompt template for a given action.
 * Checks partner-specific overrides first, then system defaults from DB,
 * then falls back to built-in defaults.
 */
export async function getPromptTemplate(
  action: AiAction,
  partnerId?: string,
): Promise<string> {
  // 1. Check partner-specific override
  if (partnerId) {
    const [partnerTemplate] = await db
      .select({ template: aiPromptTemplates.template })
      .from(aiPromptTemplates)
      .where(
        and(
          eq(aiPromptTemplates.action, action),
          eq(aiPromptTemplates.partnerId, partnerId),
        ),
      )
      .limit(1);

    if (partnerTemplate) return partnerTemplate.template;
  }

  // 2. Check system default from DB (partnerId = NULL)
  const [systemTemplate] = await db
    .select({ template: aiPromptTemplates.template })
    .from(aiPromptTemplates)
    .where(
      and(
        eq(aiPromptTemplates.action, action),
        isNull(aiPromptTemplates.partnerId),
      ),
    )
    .limit(1);

  if (systemTemplate) return systemTemplate.template;

  // 3. Fall back to built-in
  return DEFAULTS[action];
}

/**
 * Interpolate a template with variables.
 * Replaces {{key}} with the corresponding value.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
