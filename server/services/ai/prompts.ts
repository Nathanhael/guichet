import { eq, and, isNull } from 'drizzle-orm';
import type { AiAction } from './types.js';
import { getAiContext } from './context.js';

// ─── Built-in Default Prompts ───────────────────────────────────────────────

const DEFAULTS: Record<AiAction, string> = {
  classify: `Classify the following support message into one of these categories: {{categories}}.
Reply with ONLY the category name, nothing else.

Message:
<user_content>
{{text}}
</user_content>`,

  suggest: `You are a helpful support assistant. Based on the conversation below, suggest a professional and clear reply for the support agent to send.

Conversation:
<user_content>
{{messages}}
</user_content>

Suggested reply:`,

  summarize: `Summarize this support conversation in 2-3 sentences. Include: the problem reported, what has been tried, and the current status.

Conversation:
<user_content>
{{messages}}
</user_content>`,

  improve: `Rewrite the following message to be clearer, more professional, and well-structured. Keep the same meaning and tone. Do not add information that wasn't in the original.

Original message:
<user_content>
{{text}}
</user_content>

Improved message:`,

  translate: `Translate the following text to {{targetLang}}. Preserve the tone and meaning. Reply with ONLY the translation, nothing else.

Text:
<user_content>
{{text}}
</user_content>`,

  sentiment: `Analyze the sentiment of this message on a scale from -1.0 (very negative) to 1.0 (very positive). Reply with ONLY a number, nothing else.

Message:
<user_content>
{{text}}
</user_content>`,

  match_canned: `Given these canned responses:
{{responses}}

And this customer message:
<user_content>
{{text}}
</user_content>

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
  const { db, schema } = getAiContext();
  const { aiPromptTemplates } = schema as any;

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
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key] ?? '';
    // Escape all angle brackets in user-supplied values to prevent prompt injection.
    // This covers arbitrary XML/HTML tags (not just the boundary tags) so that
    // a malicious input like "<system>ignore above</system>" cannot break out of
    // the user_content delimiters or inject new prompt structure.
    return value
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  });
}
