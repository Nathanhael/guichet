import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computePrewarmTargets } from './message.js';

describe('computePrewarmTargets', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns empty when partner has queueLangAwareness off', () => {
    const out = computePrewarmTargets({
      senderLang: 'fr', ticketAgentLang: 'nl',
      viewerLangs: new Set(['nl', 'fr']),
      aiFeatures: { translation: true, queueLangAwareness: false },
    });
    expect(out).toEqual([]);
  });

  it('returns empty when translation feature off', () => {
    const out = computePrewarmTargets({
      senderLang: 'fr', ticketAgentLang: 'nl',
      viewerLangs: new Set(['nl', 'fr']),
      aiFeatures: { translation: false, queueLangAwareness: true },
    });
    expect(out).toEqual([]);
  });

  it('returns viewer langs distinct from sender lang when both flags on', () => {
    const out = computePrewarmTargets({
      senderLang: 'fr', ticketAgentLang: 'nl',
      viewerLangs: new Set(['nl', 'fr', 'en']),
      aiFeatures: { translation: true, queueLangAwareness: true },
    });
    expect(out.sort()).toEqual(['en', 'nl']);
  });

  it('returns empty when ticket is same-lang (no one needs translation)', () => {
    const out = computePrewarmTargets({
      senderLang: 'fr', ticketAgentLang: 'fr',
      viewerLangs: new Set(['fr']),
      aiFeatures: { translation: true, queueLangAwareness: true },
    });
    expect(out).toEqual([]);
  });
});
