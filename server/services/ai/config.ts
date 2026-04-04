import { eq } from 'drizzle-orm';
import type { PartnerAiConfig, ImprovementMode } from './types.js';
import { getAiContext } from './context.js';

const DEFAULT_CONFIG: PartnerAiConfig = {
  messageImprovement: 'off',
  chatSummarization: false,
  translation: false,
  sentimentDetection: false,
  autoSummarizeOnClose: false,
};

/**
 * Get the merged AI config for a partner.
 * Global AI_ENABLED must be true AND per-partner feature must be enabled.
 * Returns all-off config if AI is globally disabled or partner has AI off.
 */
export async function getPartnerAiConfig(partnerId: string): Promise<PartnerAiConfig> {
  const { db, config, schema } = getAiContext();
  const { partners } = schema;

  // Global kill switch
  if (!config.AI_ENABLED) return { ...DEFAULT_CONFIG };

  const [partner] = await db
    .select({
      aiEnabled: partners.aiEnabled,
      aiFeatures: partners.aiFeatures,
    })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1);

  if (!partner?.aiEnabled) return { ...DEFAULT_CONFIG };

  const features = (partner.aiFeatures ?? {}) as Record<string, unknown>;

  // Backward-compat: convert old boolean `messageImprovement: true` to 'optional'
  let improvementMode: ImprovementMode = 'off';
  const raw = features.messageImprovement;
  if (raw === true) improvementMode = 'optional';
  else if (raw === 'optional' || raw === 'forced') improvementMode = raw;

  return {
    messageImprovement: improvementMode,
    chatSummarization: features.chatSummarization === true,
    translation: features.translation === true,
    sentimentDetection: features.sentimentDetection === true,
    autoSummarizeOnClose: features.autoSummarizeOnClose === true,
  };
}

/**
 * Check if a specific boolean AI feature is enabled for a partner.
 * For messageImprovement, returns true if mode is 'optional' or 'forced'.
 */
export async function isFeatureEnabled(
  partnerId: string,
  feature: 'messageImprovement' | 'chatSummarization' | 'translation' | 'sentimentDetection' | 'autoSummarizeOnClose',
): Promise<boolean> {
  const aiConfig = await getPartnerAiConfig(partnerId);
  const val = aiConfig[feature];
  if (feature === 'messageImprovement') {
    return val === 'optional' || val === 'forced';
  }
  return val === true;
}
