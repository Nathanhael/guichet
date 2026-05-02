import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const GENERIC_MSG = 'An unexpected error occurred';

describe('error message leak prevention', () => {
  const files = [
    { name: 'feedback.ts', path: '../../../trpc/routers/feedback.ts' },
    { name: 'rating.ts', path: '../../../trpc/routers/rating.ts' },
  ];

  for (const file of files) {
    describe(file.name, () => {
      it('does not pass errMsg() directly to INTERNAL_SERVER_ERROR TRPCError', () => {
        const source = readFileSync(join(__dirname, file.path), 'utf-8');
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("'INTERNAL_SERVER_ERROR'")) {
            const context = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
            expect(context).toContain(GENERIC_MSG);
          }
        }
      });
    });
  }
});
