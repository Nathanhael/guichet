/**
 * Behavior tests for the CI guard that enforces the tenant-isolation
 * allowlist: `partnerId: z.*` inputs are only allowed in `support.ts`
 * and anything under `platform/`. Any other router that accepts a
 * client-supplied `partnerId` is a tenant-isolation regression.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = join(__dirname, '../../scripts/check-trpc-tenant-isolation.mjs');
const REAL_ROOT = join(__dirname, '../../trpc/routers');

function run(rootDir: string) {
  return spawnSync('node', [SCRIPT, rootDir], { encoding: 'utf-8' });
}

describe('check-trpc-tenant-isolation guard', () => {
  it('exits 0 on the real server/trpc/routers tree (allowlist is clean)', () => {
    const { status } = run(REAL_ROOT);
    expect(status).toBe(0);
  });

  describe('against a fixture tree', () => {
    let tmp: string;

    beforeAll(() => {
      tmp = mkdtempSync(join(tmpdir(), 'trpc-guard-'));
      mkdirSync(join(tmp, 'platform'), { recursive: true });
      // Allowlisted: support.ts — may have partnerId input.
      writeFileSync(
        join(tmp, 'support.ts'),
        `export const x = router({ enter: op.input(z.object({ partnerId: z.string() })) });\n`,
      );
      // Allowlisted: platform/anything.ts — may have partnerId input.
      writeFileSync(
        join(tmp, 'platform', 'users.ts'),
        `export const x = router({ op: p.input(z.object({ partnerId: z.string() })) });\n`,
      );
      // Violations: any other router with partnerId in an input schema.
      writeFileSync(
        join(tmp, 'presence.ts'),
        `export const x = router({ get: p.input(z.object({ userId: z.string(), partnerId: z.string() })) });\n`,
      );
      writeFileSync(
        join(tmp, 'ticket.ts'),
        `export const x = router({ list: p.input(z.object({\n  partnerId: z.string().optional(),\n})) });\n`,
      );
    });

    afterAll(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it('exits non-zero when a non-allowlisted file accepts partnerId', () => {
      const { status } = run(tmp);
      expect(status).not.toBe(0);
    });

    it('reports the offending file+line and ignores allowlisted files', () => {
      const { stdout, stderr } = run(tmp);
      const out = stdout + stderr;
      // Violation line format: `<relpath>:<line>: <trimmed source>`
      expect(out).toMatch(/presence\.ts:1:/);
      expect(out).toMatch(/ticket\.ts:2:/);
      // Allowlisted files must not appear as violations (the path may
      // still appear in the heading "outside allowlist (support.ts, …)"
      // — that's why we anchor on the `filename:line:` violation format).
      expect(out).not.toMatch(/support\.ts:\d+:/);
      expect(out).not.toMatch(/platform[/\\]users\.ts:\d+:/);
    });
  });
});
