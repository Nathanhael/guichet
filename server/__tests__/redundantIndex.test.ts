import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Redundant index removal (#39)', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '../db/schema.ts'), 'utf-8'
  );

  it('does not have idx_daily_ai_usage_date_partner index', () => {
    expect(schemaSource).not.toMatch(/idx_daily_ai_usage_date_partner/);
  });

  it('still has the partner_date index for reverse lookups', () => {
    expect(schemaSource).toMatch(/idx_daily_ai_usage_partner_date/);
  });

  it('still has the unique composite index', () => {
    expect(schemaSource).toMatch(/idx_daily_ai_usage_unique/);
  });
});
