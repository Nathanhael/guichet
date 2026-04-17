import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Source-level assertions for the per-user rate limit on
 * `linkPreview.fetchForCompose`. The global tRPC limiter is per-IP and shared
 * across every tRPC procedure (200/min) — this adds a per-identity cap so a
 * single authenticated session cannot exhaust that budget probing external
 * hosts via the server's egress.
 *
 * Matches the source-inspection pattern used across this repo
 * (drizzleJournal, ssoGuestB2b, ssoInviteClaim, inviteCleanup).
 */
describe('linkPreview per-user rate limit (M1)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../trpc/routers/linkPreview.ts'), 'utf-8',
  );

  describe('configuration', () => {
    it('uses a 60-second window', () => {
      expect(src).toMatch(/LINK_PREVIEW_WINDOW_SECS\s*=\s*60\b/);
    });

    it('caps at 20 fetches per window', () => {
      expect(src).toMatch(/LINK_PREVIEW_MAX_PER_WINDOW\s*=\s*20\b/);
    });

    it('scopes the Redis key by userId (not IP)', () => {
      // Per-user scope is the whole point of this limit.
      expect(src).toMatch(/`rl:lp:\$\{userId\}`/);
    });
  });

  describe('enforcement', () => {
    it('uses INCR + EXPIRE atomic-style counter', () => {
      expect(src).toMatch(/pubClient\.incr\(key\)/);
      expect(src).toMatch(/pubClient\.expire\(key,\s*LINK_PREVIEW_WINDOW_SECS\)/);
    });

    it('sets expiry only on first increment', () => {
      // Resetting TTL on every call would let an attacker keep a key alive
      // forever and never hit the window rollover.
      expect(src).toMatch(/if\s*\(\s*count\s*===\s*1\s*\)\s*\{[\s\S]*?pubClient\.expire/);
    });

    it('throws TOO_MANY_REQUESTS when count exceeds the cap', () => {
      const throwBlock = src.match(
        /if\s*\(\s*count\s*>\s*LINK_PREVIEW_MAX_PER_WINDOW\s*\)[\s\S]*?throw\s+new\s+TRPCError\([\s\S]*?\}\)/,
      );
      expect(throwBlock).toBeTruthy();
      expect(throwBlock![0]).toMatch(/code:\s*['"]TOO_MANY_REQUESTS['"]/);
    });

    it('logs a warn line when the limit is hit', () => {
      expect(src).toMatch(/logger\.warn\(\{[^}]*userId[^}]*count[^}]*\},\s*['"]\[linkPreview\] per-user rate limit exceeded['"]/);
    });
  });

  describe('wiring into the procedure', () => {
    it('calls enforcePerUserLimit inside fetchForCompose', () => {
      const procBlock = src.match(/fetchForCompose:\s*protectedProcedure[\s\S]*?\}\)\s*,?\s*\}\)/);
      expect(procBlock).toBeTruthy();
      expect(procBlock![0]).toMatch(/enforcePerUserLimit\(ctx\.user\.id\)/);
    });

    it('runs enforcement BEFORE extractUrls so regex cycles are not burned pre-limit', () => {
      const limitIdx = src.search(/enforcePerUserLimit\(ctx\.user\.id\)/);
      const extractIdx = src.search(/extractUrls\(input\.text\)/);
      expect(limitIdx).toBeGreaterThan(-1);
      expect(extractIdx).toBeGreaterThan(-1);
      expect(limitIdx).toBeLessThan(extractIdx);
    });
  });

  describe('fail-open on Redis outage', () => {
    it('returns silently when pubClient is unavailable', () => {
      // Security preference: do NOT block legit previews on Redis downtime.
      // The upstream SSRF guards in fetchOgData still protect; worst case the
      // global tRPC IP limiter covers the abuse window.
      expect(src).toMatch(/if\s*\(\s*!pubClient\s*\)\s*\{\s*[^}]*return;?\s*\}/);
    });

    it('re-throws TRPCError from inside the try/catch (does not swallow rate-limit rejection)', () => {
      // The catch block must distinguish a rate-limit rejection (re-throw)
      // from a Redis infra error (fail open) — otherwise the 429 gets eaten.
      expect(src).toMatch(/if\s*\(\s*err\s+instanceof\s+TRPCError\s*\)\s*throw\s+err/);
    });

    it('logs a warn line on Redis error but continues', () => {
      expect(src).toMatch(/logger\.warn\([\s\S]*?\[linkPreview\] rate limit check failed, allowing/);
    });
  });
});
