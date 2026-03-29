import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('GDPR aggregation optimization (#36)', () => {
  const gdprSource = fs.readFileSync(
    path.resolve(__dirname, '../services/gdpr.ts'), 'utf-8'
  );

  it('uses grouped SQL queries instead of per-partner loops', () => {
    expect(gdprSource).toMatch(/GROUP BY.*partner_id|group.*partner/i);
  });

  it('does not have nested per-partner query loop', () => {
    const hasNestedPartnerLoop = /for.*partnerId.*of partnerIds[\s\S]{1,500}await query/.test(gdprSource);
    expect(hasNestedPartnerLoop).toBe(false);
  });
});
