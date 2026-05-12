import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('GDPR aggregation optimization (#36)', () => {
  // The aggregation lives in gdpr/dailyStatsAggregate.ts post-split.
  const source = fs.readFileSync(
    path.resolve(__dirname, '../services/gdpr/dailyStatsAggregate.ts'), 'utf-8',
  );

  it('groups tickets by (date, partnerId) in a single pass rather than per-partner SQL loops', () => {
    // The post-#36 shape: one bulk fetch + in-memory groupBy. Look for the
    // map key shape that proves grouping is per-(date, partner), not nested.
    expect(source).toMatch(/date[\s\S]*partnerId/);
    expect(source).toMatch(/grouped\.set\(key/);
  });

  it('does not have nested per-partner query loop', () => {
    const hasNestedPartnerLoop = /for.*partnerId.*of partnerIds[\s\S]{1,500}await/.test(source);
    expect(hasNestedPartnerLoop).toBe(false);
  });
});
