import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.join(__dirname, '../app.ts'), 'utf-8');

// SEC-6 + tenant-isolation gate are enforced by middleware/uploadProxy.ts.
// Behavioral coverage (401 / 403 / 404 / 200 / path-traversal) lives in
// middleware/uploadProxy.test.ts. This file only asserts that app.ts wires
// the gate so the handler can`t be silently bypassed by a future edit that
// drops the route.
describe('SEC-6: /uploads is mounted behind the tenant gate', () => {
  it('imports the upload proxy handler', () => {
    expect(appSource).toMatch(/import\s*\{\s*uploadProxyHandler\s*\}\s*from\s*['"][^'"]*uploadProxy[^'"]*['"]/);
  });

  it('mounts the proxy at /uploads using the imported handler', () => {
    expect(appSource).toMatch(/app\.use\(\s*['"]\/uploads['"]\s*,\s*uploadProxyHandler\s*\)/);
  });
});
