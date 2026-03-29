import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('mediaUrl origin validation (#19)', () => {
  const bubbleSource = fs.readFileSync(
    path.resolve(__dirname, '../components/MessageBubble.tsx'), 'utf-8'
  );

  it('validates mediaUrl starts with /api/v1/uploads/', () => {
    expect(bubbleSource).toMatch(/mediaUrl.*startsWith.*\/api\/v1\/uploads\//);
  });

  it('adds referrerPolicy="no-referrer" to attachment img', () => {
    expect(bubbleSource).toMatch(/referrerPolicy.*no-referrer/);
  });
});
