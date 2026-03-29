import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('savedViews JSONB validation (#33)', () => {
  const savedViewSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/savedView.ts'), 'utf-8'
  );

  it('does not use .passthrough() on filtersSchema', () => {
    expect(savedViewSource).not.toMatch(/\.passthrough\(\)/);
  });

  it('uses .strict() on filtersSchema', () => {
    expect(savedViewSource).toMatch(/\.strict\(\)/);
  });

  it('enumerates valid filter fields', () => {
    expect(savedViewSource).toMatch(/dept.*z\.string/);
    expect(savedViewSource).toMatch(/tab.*z\.enum/);
    expect(savedViewSource).toMatch(/status.*z\.string/);
    expect(savedViewSource).toMatch(/labels.*z\.array/);
    expect(savedViewSource).toMatch(/search.*z\.string/);
    expect(savedViewSource).toMatch(/dateFrom.*z\.string/);
    expect(savedViewSource).toMatch(/dateTo.*z\.string/);
    expect(savedViewSource).toMatch(/agentId.*z\.string/);
  });
});
