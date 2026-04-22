import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('unreadTickets uses Record instead of Set (#40)', () => {
  const ticketSliceSource = fs.readFileSync(
    path.resolve(__dirname, '../store/slices/ticketSlice.ts'), 'utf-8'
  );

  it('does not use Set for unreadTickets', () => {
    expect(ticketSliceSource).not.toMatch(/Set<string>/);
    expect(ticketSliceSource).not.toMatch(/new Set/);
  });

  it('uses Record<string, number> for unreadTickets', () => {
    expect(ticketSliceSource).toMatch(/Record<string,\s*number>/);
  });
});
