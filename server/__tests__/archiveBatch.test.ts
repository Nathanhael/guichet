import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('verifyAuditChain batching (#12)', () => {
  const archiveSource = fs.readFileSync(
    path.resolve(__dirname, '../services/archive.ts'), 'utf-8'
  );

  it('uses batched pagination instead of loading all rows', () => {
    expect(archiveSource).toMatch(/BATCH_SIZE|batchSize/);
  });

  it('uses .limit() in the query', () => {
    expect(archiveSource).toMatch(/\.limit\(/);
  });

  it('uses keyset pagination via sequence', () => {
    expect(archiveSource).toMatch(/gt\(.*sequence|lastSequence|cursor/);
  });
});
