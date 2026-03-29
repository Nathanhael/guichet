import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.join(__dirname, '../app.ts'), 'utf-8');

describe('SEC-6: /uploads route authentication guard', () => {
  it('should import jsonwebtoken in app.ts', () => {
    expect(appSource).toMatch(/import jwt from ['"]jsonwebtoken['"]/);
  });

  it('should have a JWT cookie check middleware before express.static for /uploads', () => {
    // Find the /uploads block — must contain tessera_token check before express.static
    const uploadsBlock = appSource.match(
      /app\.use\(['"]\/uploads['"][\s\S]*?express\.static\(rootUploadDir\)\)/
    );
    expect(uploadsBlock).not.toBeNull();

    const block = uploadsBlock![0];

    // Must check tessera_token cookie
    expect(block).toContain('tessera_token');

    // Must call jwt.verify
    expect(block).toMatch(/jwt\.verify\(/);

    // Must respond 401 when no token
    expect(block).toContain('401');

    // express.static must come AFTER the auth middleware (later in the string)
    const authCheckPos = block.indexOf('tessera_token');
    const staticPos = block.indexOf('express.static');
    expect(authCheckPos).toBeLessThan(staticPos);
  });

  it('should return 401 json error when token is missing', () => {
    expect(appSource).toContain("'Authentication required'");
  });

  it('should use config.JWT_SECRET for verification', () => {
    expect(appSource).toMatch(/jwt\.verify\(token,\s*config\.JWT_SECRET\)/);
  });
});
