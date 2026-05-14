import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../utils/trpc', () => ({
  trpc: {
    ai: {
      healthCheck: {
        useQuery: vi.fn(),
      },
    },
  },
}));

import { trpc } from '../utils/trpc';
import { useAiHealth } from './useAiHealth';

type QueryArgs = [
  undefined,
  { refetchInterval?: number; refetchOnWindowFocus?: boolean; staleTime?: number; enabled?: boolean },
];

function queryMock() {
  return trpc.ai.healthCheck.useQuery as unknown as ReturnType<typeof vi.fn>;
}

function lastCallOpts(): QueryArgs[1] {
  const mock = queryMock();
  return mock.mock.calls[mock.mock.calls.length - 1]?.[1] as QueryArgs[1];
}

describe('useAiHealth', () => {
  beforeEach(() => {
    queryMock().mockReset();
  });

  it('returns available=false and null lastChecked while query has no data', () => {
    queryMock().mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useAiHealth());
    expect(result.current.available).toBe(false);
    expect(result.current.lastChecked).toBeNull();
  });

  it('returns available=true and the lastChecked ISO when the query resolves available=true', () => {
    queryMock().mockReturnValue({
      data: { available: true, lastChecked: '2026-05-02T17:30:00.000Z' },
    });
    const { result } = renderHook(() => useAiHealth());
    expect(result.current.available).toBe(true);
    expect(result.current.lastChecked).toBe('2026-05-02T17:30:00.000Z');
  });

  it('returns available=false when the query resolves available=false', () => {
    queryMock().mockReturnValue({
      data: { available: false, lastChecked: '2026-05-02T17:30:00.000Z' },
    });
    const { result } = renderHook(() => useAiHealth());
    expect(result.current.available).toBe(false);
  });

  it('returns available=false when the query is in error state', () => {
    queryMock().mockReturnValue({ data: undefined, error: new Error('network') });
    const { result } = renderHook(() => useAiHealth());
    expect(result.current.available).toBe(false);
    expect(result.current.lastChecked).toBeNull();
  });

  it('configures the query to refetch every 5 minutes', () => {
    queryMock().mockReturnValue({ data: undefined });
    renderHook(() => useAiHealth());
    expect(lastCallOpts().refetchInterval).toBe(300_000);
  });

  it('configures the query to refetch on window focus', () => {
    queryMock().mockReturnValue({ data: undefined });
    renderHook(() => useAiHealth());
    expect(lastCallOpts().refetchOnWindowFocus).toBe(true);
  });

  it('uses a staleTime that matches the refetch interval to avoid double-firing', () => {
    queryMock().mockReturnValue({ data: undefined });
    renderHook(() => useAiHealth());
    expect(lastCallOpts().staleTime).toBe(300_000);
  });

  it('respects an explicit enabled=false option', () => {
    queryMock().mockReturnValue({ data: undefined });
    renderHook(() => useAiHealth({ enabled: false }));
    expect(lastCallOpts().enabled).toBe(false);
  });

  it('defaults enabled to true when no option is passed', () => {
    queryMock().mockReturnValue({ data: undefined });
    renderHook(() => useAiHealth());
    expect(lastCallOpts().enabled).toBe(true);
  });
});
