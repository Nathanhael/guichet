import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The verifyAuditChain endpoint scans the entire audit_archive and recomputes
// every SHA-256 chain hash. Without throttling, a single operator (or a
// compromised session) could spam the endpoint and saturate CPU+DB.
// These tests assert the source-level invariants of the per-operator guard.

const source = readFileSync(
  join(__dirname, '../platform/audit.ts'),
  'utf-8',
);

describe('verifyAuditChain — per-operator rate limit', () => {
  it('defines a per-operator throttle with a sub-5-minute window', () => {
    expect(source).toMatch(/VERIFY_CHAIN_WINDOW_SECS\s*=\s*60\b/);
    expect(source).toMatch(/VERIFY_CHAIN_MAX_PER_WINDOW\s*=\s*1\b/);
  });

  it('keys the limiter by userId, not IP — prevents shared-IP stampedes', () => {
    expect(source).toMatch(/rate:verify-audit-chain:\$\{userId\}/);
  });

  it('invokes the guard before running the (expensive) scan', () => {
    const guardIdx = source.indexOf('assertVerifyChainAllowed(ctx.user.id)');
    const importIdx = source.indexOf("import('../../../services/archive.js')");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(importIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(importIdx);
  });

  it('throws TOO_MANY_REQUESTS with a retry hint when exceeded', () => {
    expect(source).toMatch(/code:\s*'TOO_MANY_REQUESTS'/);
    expect(source).toMatch(/Retry in \$\{retryAfter\}s/);
  });

  it('fails open when Redis is unavailable — platform ops never get locked out by infra', () => {
    // The catch block must NOT rethrow generic redis errors; only TRPCError
    // (which is our own rate-limit signal) propagates.
    expect(source).toMatch(/if \(err instanceof TRPCError\) throw err/);
    expect(source).toMatch(/verify-chain rate-limit check failed, allowing/);
  });

  it('uses INCR + EXPIRE (atomic counter, not a GET/SET race)', () => {
    expect(source).toMatch(/pubClient\.incr\(key\)/);
    expect(source).toMatch(/pubClient\.expire\(key, VERIFY_CHAIN_WINDOW_SECS\)/);
    // First increment sets the TTL — subsequent increments must not reset it
    expect(source).toMatch(/if \(count === 1\) await pubClient\.expire/);
  });
});

describe('verifyAuditChain — persists last run to system_settings', () => {
  it('writes the run record so every operator sees the same last-verified state', () => {
    // Upsert pattern — keyed by LAST_VERIFY_KEY
    expect(source).toMatch(/LAST_VERIFY_KEY\s*=\s*'audit_chain_last_verify'/);
    expect(source).toMatch(/insert\(systemSettings\)/);
    expect(source).toMatch(/onConflictDoUpdate/);
    expect(source).toMatch(/target:\s*systemSettings\.key/);
  });

  it('stamps the actor (ranBy) and ran-at timestamp on every run', () => {
    expect(source).toMatch(/ranAt:\s*new Date\(\)\.toISOString\(\)/);
    expect(source).toMatch(/ranBy:\s*ctx\.user\.id/);
  });

  it('is a mutation — it writes to the DB, so GET caching would be wrong', () => {
    // A query would let tRPC batch/cache across clients; we specifically want
    // every click to produce a fresh run record and invalidate dashboards.
    expect(source).toMatch(/verifyAuditChain:\s*platformProcedure\s*\.mutation/);
  });

  it('exposes a getLastChainVerify query for hydration without running a scan', () => {
    expect(source).toMatch(/getLastChainVerify:\s*platformProcedure\s*\.query/);
    expect(source).toMatch(/eq\(systemSettings\.key,\s*LAST_VERIFY_KEY\)/);
  });
});
