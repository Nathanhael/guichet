import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDashboardFilters } from '../useDashboardFilters';

function setUrl(search: string) {
  const url = `${window.location.pathname}${search}`;
  window.history.replaceState(null, '', url);
}

function currentSearch(): string {
  return window.location.search;
}

describe('useDashboardFilters', () => {
  beforeEach(() => {
    setUrl('');
  });

  afterEach(() => {
    setUrl('');
  });

  it('defaults to 7d preset, no dept, weekends included', () => {
    const { result } = renderHook(() => useDashboardFilters());
    expect(result.current.filters).toMatchObject({
      preset: '7d',
      dept: undefined,
      excludeWeekends: false,
    });
    expect(currentSearch()).toBe('');
  });

  it('hydrates from URL on mount', () => {
    setUrl('?preset=14d&dept=sales&weekends=off');
    const { result } = renderHook(() => useDashboardFilters());
    expect(result.current.filters).toMatchObject({
      preset: '14d',
      dept: 'sales',
      excludeWeekends: true,
    });
  });

  it('applyPreset writes the preset to the URL', () => {
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.applyPreset('30d'));
    expect(result.current.filters.preset).toBe('30d');
    expect(currentSearch()).toBe('?preset=30d');
  });

  it('applyPreset back to the default 7d strips it from the URL', () => {
    setUrl('?preset=30d');
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.applyPreset('7d'));
    expect(result.current.filters.preset).toBe('7d');
    expect(currentSearch()).toBe('');
  });

  it('setFilter dept writes and clears cleanly', () => {
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.setFilter('dept', 'support'));
    expect(currentSearch()).toBe('?dept=support');
    act(() => result.current.setFilter('dept', undefined));
    expect(currentSearch()).toBe('');
    expect(result.current.filters.dept).toBeUndefined();
  });

  it('setting a custom date flips preset to "custom"', () => {
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.setFilter('dateFrom', '2026-01-01'));
    expect(result.current.filters.preset).toBe('custom');
    expect(result.current.filters.dateFrom).toBe('2026-01-01');
    const params = new URLSearchParams(currentSearch());
    expect(params.get('preset')).toBe('custom');
    expect(params.get('from')).toBe('2026-01-01');
  });

  it('toggling excludeWeekends round-trips through the URL', () => {
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.setFilter('excludeWeekends', true));
    expect(currentSearch()).toBe('?weekends=off');
    act(() => result.current.setFilter('excludeWeekends', false));
    expect(currentSearch()).toBe('');
  });

  it('reset clears every filter and the URL', () => {
    setUrl('?preset=30d&dept=sales&weekends=off&from=2026-01-01&to=2026-02-01');
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.reset());
    expect(result.current.filters).toMatchObject({
      preset: '7d',
      dept: undefined,
      excludeWeekends: false,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(currentSearch()).toBe('');
  });

  it('popstate re-reads filters from the URL (back/forward navigation)', () => {
    const { result } = renderHook(() => useDashboardFilters());
    act(() => {
      setUrl('?preset=30d&dept=billing');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.filters.preset).toBe('30d');
    expect(result.current.filters.dept).toBe('billing');
  });

  it('ignores unknown preset values from the URL and falls back to 7d', () => {
    setUrl('?preset=bogus');
    const { result } = renderHook(() => useDashboardFilters());
    expect(result.current.filters.preset).toBe('7d');
  });
});
