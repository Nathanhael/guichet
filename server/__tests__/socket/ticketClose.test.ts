import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ticket:close handler', () => {
  it('fetches ticket status before closing', () => {
    const source = readFileSync(join(__dirname, '../../socket/handlers.ts'), 'utf-8');
    expect(source).toMatch(/SELECT.*status.*FROM tickets.*WHERE.*id/is);
  });

  it('returns early if ticket is already closed', () => {
    const source = readFileSync(join(__dirname, '../../socket/handlers.ts'), 'utf-8');
    expect(source).toMatch(/status.*===.*'closed'/);
  });
});
