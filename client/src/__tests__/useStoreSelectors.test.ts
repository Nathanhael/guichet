import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('useStore selector usage', () => {
  const files = [
    'components/ChatWindow.tsx',
    'components/MessageBubble.tsx',
  ];

  for (const file of files) {
    it(`${file} does not use bare useStore()`, () => {
      const source = readFileSync(join(__dirname, '..', file), 'utf-8');
      const bareUseStore = source.match(/\buseStore\(\s*\)/g);
      expect(bareUseStore).toBeNull();
    });
  }
});
