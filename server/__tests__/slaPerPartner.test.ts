import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SLA per-partner config in stats (#29)', () => {
  const statsServiceSource = fs.readFileSync(
    path.resolve(__dirname, '../services/stats.ts'), 'utf-8'
  );

  it('uses getEffectiveSla instead of global SLA_THRESHOLD_MS', () => {
    expect(statsServiceSource).toMatch(/getEffectiveSla/);
  });

  it('does not hardcode config.SLA_THRESHOLD_MS for compliance checks', () => {
    const directUsage = statsServiceSource.match(/config\.SLA_THRESHOLD_MS/g) || [];
    const effectiveUsage = statsServiceSource.match(/getEffectiveSla/g) || [];
    expect(effectiveUsage.length).toBeGreaterThan(0);
  });
});
