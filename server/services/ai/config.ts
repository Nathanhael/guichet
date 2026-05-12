import { eq } from 'drizzle-orm';
import type { PartnerAiConfig, ImprovementMode } from './types.js';
import { getAiContext } from './context.js';
import { isUserOptedOut } from './optOut.js';

const DEFAULT_CONFIG: PartnerAiConfig = {
  messageImprovement: 'off',
  translation: false,
};

/**
 * What the client sees after partner config and per-user opt-out are merged.
 * `messageImprovement` is degraded from 'forced' to 'optional' when the
 * caller has opted out — auto-improve-on-send becomes a manual sparkle click
 * for that one worker, while the partner-wide policy stays intact for others.
 * `partnerMessageImprovement` exposes the original partner-level setting so
 * the UI can surface "Auto-verbetering wordt voor jou optioneel" when relevant.
 */
export interface EffectiveAiConfig extends PartnerAiConfig {
  aiOptOut: boolean;
  partnerMessageImprovement: ImprovementMode;
}

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
    translation: features.translation === true,
    voiceTranscription: features.voiceTranscription === true,
    cannedTranslation: features.cannedTranslation === true,
  };
}

/**
 * Effective AI config for a specific worker. Folds the partner config in with
 * `memberships.aiOptOut` so the client doesn't need to know the override rule.
 *
 * Rule: when `aiOptOut` is true AND partner `messageImprovement` is `'forced'`,
 * the effective mode for this user is `'optional'`. All other config carries
 * through unchanged — translation, voice transcription etc. remain functional
 * because anonymization (not de-featurization) is the contract.
 */
export async function getEffectiveAiConfig(
  partnerId: string,
  userId: string,
): Promise<EffectiveAiConfig> {
  const partnerConfig = await getPartnerAiConfig(partnerId);
  const aiOptOut = await isUserOptedOut(partnerId, userId);
  const partnerMessageImprovement = partnerConfig.messageImprovement ?? 'off';
  const effectiveImprovement: ImprovementMode =
    aiOptOut && partnerMessageImprovement === 'forced'
      ? 'optional'
      : partnerMessageImprovement;
  return {
    ...partnerConfig,
    messageImprovement: effectiveImprovement,
    aiOptOut,
    partnerMessageImprovement,
  };
}

/**
 * Check if a specific boolean AI feature is enabled for a partner.
 * For messageImprovement, returns true if mode is 'optional' or 'forced'.
 */
export async function isFeatureEnabled(
  partnerId: string,
  feature:
    | 'messageImprovement'
    | 'translation'
    | 'voiceTranscription'
    | 'cannedTranslation',
): Promise<boolean> {
  const aiConfig = await getPartnerAiConfig(partnerId);
  const val = aiConfig[feature];
  if (feature === 'messageImprovement') {
    return val === 'optional' || val === 'forced';
  }
  return val === true;
}
