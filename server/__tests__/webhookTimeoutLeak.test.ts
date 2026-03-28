import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Webhook dispatch timeout cleanup (#28)', () => {
  const webhookSource = fs.readFileSync(
    path.resolve(__dirname, '../services/webhookDispatch.ts'),
    'utf-8',
  );

  it('clears timeout in finally block', () => {
    expect(webhookSource).toMatch(/finally[\s\S]*?clearTimeout/);
  });
});
