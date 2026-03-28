import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Presence reconnect includes status (#25)', () => {
  const presenceSource = fs.readFileSync(
    path.resolve(__dirname, '../services/presence.ts'),
    'utf-8'
  );

  it('sets status to available in the reconnect else branch', () => {
    // Verify that the else branch (handling existing connections) includes status: 'available'
    const elseBlockStart = presenceSource.indexOf('// Existing connection');
    const elseBlockEnd = presenceSource.indexOf('await pipeline.exec()', elseBlockStart);
    const elseBlock = presenceSource.slice(elseBlockStart, elseBlockEnd);

    expect(elseBlock).toMatch(/status\s*:\s*['"]?available['"]?/);
  });

  it('includes all required fields in reconnect hSet', () => {
    const elseBlockStart = presenceSource.indexOf('// Existing connection');
    const elseBlockEnd = presenceSource.indexOf('await pipeline.exec()', elseBlockStart);
    const elseBlock = presenceSource.slice(elseBlockStart, elseBlockEnd);

    // Verify all required fields are present
    const requiredFields = ['userId', 'name', 'role', 'partnerId', 'isPlatformOperator', 'status'];
    requiredFields.forEach((field) => {
      expect(elseBlock).toContain(field);
    });
  });
});
