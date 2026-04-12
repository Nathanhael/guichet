import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.join(__dirname, '../app.ts'), 'utf-8');

describe('SEC-6: /uploads route authentication guard', () => {
  it('should import jwtVerify from jose in app.ts', () => {
    expect(appSource).toMatch(/import\s*\{[^}]*jwtVerify[^}]*\}\s*from\s*['"]jose['"]/);
  });

  it('should have a JWT cookie check before serving uploads', () => {
    // Find the /uploads block — must contain tessera_token check before file serving
    const uploadsBlock = appSource.match(
      /app\.use\(['"]\/uploads['"][\s\S]*?storage\.read\(/
    );
    expect(uploadsBlock).not.toBeNull();

    const block = uploadsBlock![0];

    // Must check tessera_token cookie
    expect(block).toContain('tessera_token');

    // Must call jwtVerify
    expect(block).toMatch(/jwtVerify\(/);

    // Must respond 401 when no token
    expect(block).toContain('401');

    // Auth check must come BEFORE storage read
    const authCheckPos = block.indexOf('tessera_token');
    const storagePos = block.indexOf('storage.read');
    expect(authCheckPos).toBeLessThan(storagePos);
  });

  it('should return 401 json error when token is missing', () => {
    expect(appSource).toContain("'Authentication required'");
  });

  it('should use config.JWT_SECRET for verification', () => {
    expect(appSource).toMatch(/jwtVerify\(token,\s*new TextEncoder/);
  });

  it('should guard against path traversal', () => {
    expect(appSource).toContain('..');
  });
});
