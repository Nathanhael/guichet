import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(
  resolve(__dirname, '../services/refreshToken.ts'),
  'utf-8',
);

// Isolate the rotateRefreshToken function body for targeted assertions
const rotateMatch = src.match(/export async function rotateRefreshToken[\s\S]*?^}/m);
const rotateFnBody = rotateMatch ? rotateMatch[0] : '';

/**
 * Extract the full body of the transaction() callback by counting braces,
 * rather than relying on a regex that can stop at a nested closing brace.
 */
function extractTransactionBody(fnBody: string): string {
  const start = fnBody.indexOf('transaction(async (tx) => {');
  if (start === -1) return '';
  const braceStart = fnBody.indexOf('{', start + 'transaction(async (tx) => '.length);
  if (braceStart === -1) return '';

  let depth = 0;
  let i = braceStart;
  for (; i < fnBody.length; i++) {
    if (fnBody[i] === '{') depth++;
    else if (fnBody[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return fnBody.slice(braceStart + 1, i);
}

describe('rotateRefreshToken atomicity contract', () => {
  it('uses transaction() inside rotateRefreshToken', () => {
    expect(rotateFnBody).toContain('transaction(');
  });

  it('revokes old token via tx.update inside the transaction', () => {
    const txBody = extractTransactionBody(rotateFnBody);
    expect(txBody).toContain('tx.update(refreshTokens)');
  });

  it('inserts new token via tx.insert inside the transaction', () => {
    const txBody = extractTransactionBody(rotateFnBody);
    expect(txBody).toContain('tx.insert(refreshTokens)');
  });

  it('does not use db.update or db.insert for the rotation steps', () => {
    const txBody = extractTransactionBody(rotateFnBody);
    // The atomic update and insert must go through tx, not the bare db handle
    expect(txBody).not.toContain('db.update(refreshTokens)');
    expect(txBody).not.toContain('db.insert(refreshTokens)');
  });
});
