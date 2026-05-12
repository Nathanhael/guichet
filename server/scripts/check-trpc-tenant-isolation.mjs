#!/usr/bin/env node
/**
 * Tenant-isolation guard: fails CI if any tRPC router outside the
 * allowlist accepts a client-supplied `partnerId` in its input schema.
 *
 * Allowlist:
 *   - `support.ts` (cross-partner read for support workflows)
 *   - anything under `platform/` (platform operator surface)
 *
 * Platform operators cross tenants only via `platform.*` endpoints or by
 * calling `POST /enter-partner` to mint a fresh JWT with the target partnerId.
 *
 * Usage: node server/scripts/check-trpc-tenant-isolation.mjs [rootDir]
 *   rootDir defaults to `server/trpc/routers` (resolved relative to cwd).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.argv[2] ?? 'server/trpc/routers';
const pattern = /partnerId:\s*z\./;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function isAllowlisted(relPath) {
  const parts = relPath.split(/[\\/]/);
  const last = parts[parts.length - 1];
  if (last === 'support.ts') return true;
  if (parts[0] === 'platform') return true;
  return false;
}

const violations = [];
for (const file of walk(root)) {
  const rel = relative(root, file);
  if (isAllowlisted(rel)) continue;
  const lines = readFileSync(file, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      violations.push(`${rel.split(sep).join('/')}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

if (violations.length > 0) {
  console.error('tenant-isolation guard: client-supplied partnerId found outside allowlist (support.ts, platform/**):');
  for (const v of violations) console.error('  ' + v);
  console.error('\nIf cross-tenant access is genuinely required, route it through platform.* or /enter-partner.');
  process.exit(1);
}

console.log(`tenant-isolation guard: clean (${root})`);
process.exit(0);
