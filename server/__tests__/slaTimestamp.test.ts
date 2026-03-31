import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SLA columns use timestamp type (#34)', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '../db/schema.ts'), 'utf-8'
  );

  it('slaResponseDueAt uses timestamp not text', () => {
    expect(schemaSource).toMatch(/slaResponseDueAt:\s*timestamp\(/);
    expect(schemaSource).not.toMatch(/slaResponseDueAt:\s*text\(/);
  });

  it('slaResolutionDueAt uses timestamp not text', () => {
    expect(schemaSource).toMatch(/slaResolutionDueAt:\s*timestamp\(/);
    expect(schemaSource).not.toMatch(/slaResolutionDueAt:\s*text\(/);
  });

  it('squashed migration includes SLA timestamp columns', () => {
    const migrationPath = path.resolve(__dirname, '../drizzle/0000_cloudy_the_twelve.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
    expect(migrationSql).toMatch(/sla_response_due_at/);
    expect(migrationSql).toMatch(/sla_resolution_due_at/);
  });
});
