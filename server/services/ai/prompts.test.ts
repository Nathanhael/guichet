import { describe, it, expect, vi } from 'vitest';

// Mock the DB module to avoid needing DATABASE_URL in tests
vi.mock('../../db/postgres.js', () => ({
  db: {},
}));

import { interpolate, stripPromptArtifacts } from './prompts.js';

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

  describe('stripPromptArtifacts', () => {
    it('removes <user_content> wrappers a model echoed back', () => {
      const raw = '<user_content>\nEntendu, je vais vérifier.\n</user_content>';
      expect(stripPromptArtifacts(raw)).toBe('Entendu, je vais vérifier.');
    });

    it('removes only the opening tag if the closing tag is absent', () => {
      expect(stripPromptArtifacts('<user_content>hello there')).toBe('hello there');
    });

    it('removes only the closing tag if the opening tag is absent', () => {
      expect(stripPromptArtifacts('hello there</user_content>')).toBe('hello there');
    });

    it('strips multiple occurrences in case the model double-wraps', () => {
      const raw = '<user_content><user_content>hi</user_content></user_content>';
      expect(stripPromptArtifacts(raw)).toBe('hi');
    });

    it('leaves clean output untouched', () => {
      expect(stripPromptArtifacts('Just a normal reply.')).toBe('Just a normal reply.');
    });

    it('does not touch unrelated angle-bracket content', () => {
      // user_content is the only tag we own; legitimate content like inline
      // code or markup-bearing replies must pass through unchanged.
      expect(stripPromptArtifacts('use <strong>bold</strong> here')).toBe(
        'use <strong>bold</strong> here',
      );
    });

    it('trims surrounding whitespace after stripping', () => {
      expect(stripPromptArtifacts('  \n<user_content>x</user_content>\n  ')).toBe('x');
    });
  });
});
