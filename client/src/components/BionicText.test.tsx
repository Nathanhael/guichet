import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import BionicText from './BionicText';
import useStore from '../store/useStore';

describe('BionicText Component', () => {
  beforeEach(() => {
    useStore.getState().setSelectedLang('en');
  });

  it('renders nothing when text is empty', () => {
    const { container } = render(<BionicText text="" />);
    expect(container.firstChild?.textContent).toBe('');
  });

  it('bolds the beginning of words (fixation)', () => {
    const { container } = render(<BionicText text="hello" />);
    // "hello" (length 5). fixationLength = ceil(5 * 0.45) = 3
    const boldSpan = container.querySelector('.font-bold');
    expect(boldSpan?.textContent).toBe('hel');
    expect(container.textContent).toBe('hello');
  });

  it('adapts fixation based on language (French)', () => {
    useStore.getState().setSelectedLang('fr');
    const { container } = render(<BionicText text="bonjour" />);
    // "bonjour" (length 7). fixationLength = ceil(7 * 0.6) = 5
    const boldSpan = container.querySelector('.font-bold');
    expect(boldSpan?.textContent).toBe('bonjo');
  });

  it('adapts fixation based on language (Dutch)', () => {
    useStore.getState().setSelectedLang('nl');
    const { container } = render(<BionicText text="hallo" />);
    // "hallo" (length 5). fixationLength = ceil(5 * 0.45) = 3
    const boldSpan = container.querySelector('.font-bold');
    expect(boldSpan?.textContent).toBe('hal');
  });

  it('preserves spaces', () => {
    const { container } = render(<BionicText text="hello world" />);
    expect(container.textContent).toBe('hello world');
  });
});
