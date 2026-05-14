import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('useTokenRefresh — in-flight mutex (SEC-4)', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../useTokenRefresh.ts'),
    'utf-8'
  );

  it('declares isRefreshingRef as a boolean useRef', () => {
    expect(source).toMatch(/isRefreshingRef\s*=\s*useRef<boolean>\(false\)/);
  });

  it('declares abortRef as an AbortController useRef', () => {
    expect(source).toMatch(/abortRef\s*=\s*useRef<AbortController\s*\|\s*null>\(null\)/);
  });

  it('guards doRefresh with the mutex at the top of the function', () => {
    // The guard must appear before lastRefreshRef is updated
    const guardIdx = source.indexOf('if (isRefreshingRef.current) return;');
    const lastRefreshUpdateIdx = source.indexOf('lastRefreshRef.current = now;');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(lastRefreshUpdateIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(lastRefreshUpdateIdx);
  });

  it('sets isRefreshingRef to true before the fetch', () => {
    const setTrueIdx = source.indexOf('isRefreshingRef.current = true;');
    const fetchIdx = source.indexOf("fetch('/api/v1/auth/refresh'");
    expect(setTrueIdx).toBeGreaterThan(-1);
    expect(setTrueIdx).toBeLessThan(fetchIdx);
  });

  it('resets isRefreshingRef to false in a finally block', () => {
    const finallyIdx = source.indexOf('finally {');
    const resetIdx = source.indexOf('isRefreshingRef.current = false;');
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(-1);
    // finally block comes before the reset assignment within it
    expect(resetIdx).toBeGreaterThan(finallyIdx);
  });

  it('passes AbortController signal to fetch', () => {
    expect(source).toMatch(/signal\s*:\s*controller\.signal/);
  });

  it('handles AbortError without retrying', () => {
    expect(source).toMatch(/AbortError/);
    // The early return for AbortError must come before the retry setTimeout
    const abortReturnIdx = source.indexOf("err.name === 'AbortError'");
    const retryIdx = source.indexOf('setTimeout(doRefresh, 30_000)');
    expect(abortReturnIdx).toBeGreaterThan(-1);
    expect(retryIdx).toBeGreaterThan(-1);
    expect(abortReturnIdx).toBeLessThan(retryIdx);
  });

  it('aborts in-flight request in cleanup function', () => {
    // The cleanup return function must abort the controller
    const cleanupBlock = source.slice(source.lastIndexOf('return () => {'));
    expect(cleanupBlock).toMatch(/abortRef\.current.*abort\(\)/);
  });
});
