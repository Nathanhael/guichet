import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LangBadge from '../LangBadge';

describe('LangBadge', () => {
  it('marks cross-lang tickets with data-cross-lang=true', () => {
    render(<LangBadge lang="nl" viewerLang="fr" />);
    const el = screen.getByText('NL');
    expect(el.getAttribute('data-cross-lang')).toBe('true');
  });

  it('marks same-lang tickets with data-cross-lang=false', () => {
    render(<LangBadge lang="fr" viewerLang="fr" />);
    const el = screen.getByText('FR');
    expect(el.getAttribute('data-cross-lang')).toBe('false');
  });

  it('renders nothing when lang is null', () => {
    const { container } = render(<LangBadge lang={null} viewerLang="fr" />);
    expect(container.firstChild).toBeNull();
  });
});
