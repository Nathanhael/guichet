/**
 * Contract test: verifies archiveAuditLog continuation loop structure.
 * Reads the source file and asserts structural invariants without executing DB code.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(
  resolve(__dirname, '../services/archive.ts'),
  'utf-8'
);

// Extract only the archiveAuditLog function body for targeted assertions
const fnMatch = src.match(/export async function archiveAuditLog[\s\S]*?^}/m);
const fnBody = fnMatch ? fnMatch[0] : src;

describe('archiveAuditLog continuation loop', () => {
  it('contains a while loop', () => {
    expect(fnBody).toMatch(/while\s*\(true\)/);
  });

  it('tracks totalArchived across batches', () => {
    expect(fnBody).toContain('totalArchived');
    expect(fnBody).toContain('totalArchived += archivedCount');
  });

  it('breaks when batch is smaller than BATCH_SIZE', () => {
    expect(fnBody).toContain('BATCH_SIZE');
    expect(fnBody).toMatch(/rows\.length\s*<\s*BATCH_SIZE/);
  });

  it('re-reads chain hash inside the loop', () => {
    // lastArchived query must appear inside the while block
    const whileStart = fnBody.indexOf('while (true)');
    const lastArchivedPos = fnBody.lastIndexOf('lastArchived');
    expect(whileStart).toBeGreaterThan(-1);
    expect(lastArchivedPos).toBeGreaterThan(whileStart);
  });

  it('returns totalArchived on error (partial count, not 0)', () => {
    // The catch block must return totalArchived, not a literal 0
    const catchStart = fnBody.indexOf('catch (err)');
    expect(catchStart).toBeGreaterThan(-1);
    const catchSlice = fnBody.slice(catchStart);
    expect(catchSlice).toContain('return totalArchived');
    // The very first return after the catch keyword must not be a bare 0
    const firstReturn = catchSlice.match(/return\s+(\S+)/);
    expect(firstReturn).not.toBeNull();
    expect(firstReturn![1]).not.toBe('0;');
    expect(firstReturn![1]).not.toBe('0');
  });

  it('logs totalArchived after the loop (not archivedCount)', () => {
    // logger.info must reference totalArchived
    expect(fnBody).toMatch(/logger\.info\s*\(\s*\{[^}]*totalArchived\b|logger\.info\s*\(\s*\{\s*count:\s*totalArchived/);
  });
});
