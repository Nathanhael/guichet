// Slice 9: validates that a partner-admin's proposed `aiFeatures` fits inside
// the platform-set `aiFeaturesAvailable` envelope. Pure function.

export type ImprovementMode = 'off' | 'optional' | 'forced';

export interface AiFeatures {
  messageImprovement?: ImprovementMode;
  chatSummarization?: boolean;
  translation?: boolean;
  autoSummarizeOnClose?: boolean;
  queueLangAwareness?: boolean;
  voiceTranscription?: boolean;
}

const IMPROVEMENT_LEVEL: Record<ImprovementMode, number> = {
  off: 0,
  optional: 1,
  forced: 2,
};

const BOOLEAN_FEATURES: ReadonlyArray<keyof AiFeatures> = [
  'chatSummarization',
  'translation',
  'autoSummarizeOnClose',
  'queueLangAwareness',
  'voiceTranscription',
];

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: string[] };

export function validateAiFeaturesEnvelope(
  proposed: AiFeatures,
  envelope: AiFeatures | null | undefined,
): ValidationResult {
  if (!envelope || Object.keys(envelope).length === 0) return { ok: true };

  const violations: string[] = [];

  // messageImprovement is hierarchical: off < optional < forced.
  if (envelope.messageImprovement !== undefined) {
    const proposedLevel = IMPROVEMENT_LEVEL[proposed.messageImprovement ?? 'off'];
    const envelopeLevel = IMPROVEMENT_LEVEL[envelope.messageImprovement];
    if (proposedLevel > envelopeLevel) {
      violations.push('messageImprovement');
    }
  }

  // Booleans: proposed=true is only allowed when envelope=true.
  for (const key of BOOLEAN_FEATURES) {
    const env = envelope[key] as boolean | undefined;
    if (env === undefined) continue;
    const prop = proposed[key] as boolean | undefined;
    if (prop === true && env !== true) {
      violations.push(key);
    }
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true };
}
