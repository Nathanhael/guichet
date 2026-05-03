// Slice 9 (decision 12): platform operator sets `aiFeaturesAvailable` envelope.
// Partner admin's `aiFeatures` proposal must validate as a subset.
// Hierarchy: messageImprovement off < optional < forced. Booleans: a feature
// can be disabled in the proposal even when allowed; a feature can NOT be
// enabled when the envelope blocks it.

import { describe, it, expect } from 'vitest';
import { validateAiFeaturesEnvelope, type AiFeatures } from './featuresEnvelope';

describe('validateAiFeaturesEnvelope', () => {
  it('allows everything when envelope is null (platform has not gated)', () => {
    const result = validateAiFeaturesEnvelope(
      { messageImprovement: 'forced', translation: true, voiceTranscription: true },
      null,
    );
    expect(result.ok).toBe(true);
  });

  it('allows everything when envelope is an empty object', () => {
    const result = validateAiFeaturesEnvelope(
      { messageImprovement: 'forced', translation: true },
      {},
    );
    expect(result.ok).toBe(true);
  });

  it('allows the proposed value when it equals the envelope', () => {
    const f: AiFeatures = {
      messageImprovement: 'optional',
      translation: true,
      voiceTranscription: true,
    };
    expect(validateAiFeaturesEnvelope(f, f).ok).toBe(true);
  });

  it('allows a strict subset (boolean dropped from true to false)', () => {
    const result = validateAiFeaturesEnvelope(
      { translation: false },
      { translation: true },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects when proposed enables a boolean the envelope blocks', () => {
    const result = validateAiFeaturesEnvelope(
      { translation: true },
      { translation: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).toContain('translation');
  });

  it('rejects when envelope.messageImprovement = off but proposed = optional', () => {
    const result = validateAiFeaturesEnvelope(
      { messageImprovement: 'optional' },
      { messageImprovement: 'off' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).toContain('messageImprovement');
  });

  it('rejects when envelope.messageImprovement = optional but proposed = forced', () => {
    const result = validateAiFeaturesEnvelope(
      { messageImprovement: 'forced' },
      { messageImprovement: 'optional' },
    );
    expect(result.ok).toBe(false);
  });

  it('allows envelope.messageImprovement = forced + proposed = optional', () => {
    const result = validateAiFeaturesEnvelope(
      { messageImprovement: 'optional' },
      { messageImprovement: 'forced' },
    );
    expect(result.ok).toBe(true);
  });

  it('allows envelope.messageImprovement = optional + proposed = off', () => {
    const result = validateAiFeaturesEnvelope(
      { messageImprovement: 'off' },
      { messageImprovement: 'optional' },
    );
    expect(result.ok).toBe(true);
  });

  it('reports multiple violations when several features over-reach at once', () => {
    const result = validateAiFeaturesEnvelope(
      { translation: true, voiceTranscription: true, messageImprovement: 'forced' },
      { translation: false, voiceTranscription: false, messageImprovement: 'optional' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toEqual(
        expect.arrayContaining(['translation', 'voiceTranscription', 'messageImprovement']),
      );
      expect(result.violations).toHaveLength(3);
    }
  });

  it('treats a missing key in proposed as "off" / false (no violation)', () => {
    const result = validateAiFeaturesEnvelope(
      {},
      { messageImprovement: 'off', translation: false },
    );
    expect(result.ok).toBe(true);
  });

  it('treats a missing key in envelope as unrestricted for that feature', () => {
    const result = validateAiFeaturesEnvelope(
      { translation: true, voiceTranscription: true },
      { translation: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toEqual(['translation']);
    }
  });

  it('covers all 4 boolean features (translation, queueLangAwareness, voiceTranscription, cannedTranslation)', () => {
    const allOn: AiFeatures = {
      translation: true,
      queueLangAwareness: true,
      voiceTranscription: true,
      cannedTranslation: true,
    };
    const allOff: AiFeatures = {
      translation: false,
      queueLangAwareness: false,
      voiceTranscription: false,
      cannedTranslation: false,
    };
    const blocked = validateAiFeaturesEnvelope(allOn, allOff);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.violations).toHaveLength(4);

    const subset = validateAiFeaturesEnvelope(allOff, allOn);
    expect(subset.ok).toBe(true);
  });

  it('rejects when proposed enables cannedTranslation but envelope blocks it', () => {
    const result = validateAiFeaturesEnvelope(
      { cannedTranslation: true },
      { cannedTranslation: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).toContain('cannedTranslation');
  });
});
