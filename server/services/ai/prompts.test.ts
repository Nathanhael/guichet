import { describe, it, expect, vi } from 'vitest';

// Mock the DB module to avoid needing DATABASE_URL in tests
vi.mock('../../db/postgres.js', () => ({
  db: {},
}));

import { interpolate } from './prompts.js';

describe('prompt helpers', () => {
  describe('interpolate', () => {
    it('replaces single variable', () => {
      expect(interpolate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
    });

    it('replaces multiple variables', () => {
      const result = interpolate('{{greeting}} {{name}}, welcome to {{place}}!', {
        greeting: 'Hi',
        name: 'Bart',
        place: 'Guichet',
      });
      expect(result).toBe('Hi Bart, welcome to Guichet!');
    });

    it('replaces missing variables with empty string', () => {
      expect(interpolate('Hello {{name}}!', {})).toBe('Hello !');
    });

    it('handles template with no variables', () => {
      expect(interpolate('No variables here', { name: 'unused' })).toBe('No variables here');
    });

    it('handles empty template', () => {
      expect(interpolate('', { name: 'test' })).toBe('');
    });

    it('replaces same variable multiple times', () => {
      expect(interpolate('{{x}} and {{x}}', { x: 'yes' })).toBe('yes and yes');
    });
  });
});
