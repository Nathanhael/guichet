/**
 * Break-glass CLI — mint a short-lived platform-operator JWT when SSO is down.
 *
 * Usage (inside the server container):
 *   docker compose exec server npx tsx server/scripts/break_glass.ts <email> [ttlMinutes]
 *
 * Prints the raw cookie value so the operator can set `guichet_token`
 * manually in their browser. Default TTL: 15 minutes. Max: 60 minutes.
 *
 * Access is gated by the server process's JWT_SECRET — whoever can run the CLI
 * already has full server shell, so no additional auth is enforced here.
 * Every invocation writes an audit_log entry with actor="break_glass_cli".
 */

import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { SignJWT } from 'jose';
import { db } from '../db.js';
import { users, auditLog } from '../db/schema.js';
import config from '../config.js';

const [, , emailArg, ttlArg] = process.argv;

if (!emailArg) {
  console.error('Usage: npx tsx server/scripts/break_glass.ts <email> [ttlMinutes]');
  process.exit(2);
}

const ttlMinutes = Math.min(Math.max(parseInt(ttlArg || '15', 10) || 15, 1), 60);
const email = emailArg.toLowerCase();

async function main() {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) {
    console.error(`[break-glass] No user found for ${email}`);
    process.exit(1);
  }
  if (!user.isPlatformOperator) {
    console.error(`[break-glass] User ${email} is not a platform operator; refusing to mint token`);
    process.exit(1);
  }
  if (user.deletedAt) {
    console.error(`[break-glass] User ${email} is soft-deleted; refusing to mint token`);
    process.exit(1);
  }

  const jti = randomUUID();
  const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);
  const token = await new SignJWT({
      jti,
      userId: user.id,
      role: 'admin',
      departments: [],
      isPlatformOperator: true,
      // Break-glass minted only for platform operators (internal staff). B2B
      // guests cannot be platform operators (TENANT_IDENTITY_SPEC), so this
      // is structurally false — but writing it explicitly keeps the JWT
      // schema satisfied without relying on the legacy `?? false` fallback.
      isExternal: false,
    })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(jwtSecret);

  await db.insert(auditLog).values({
    id: randomUUID(),
    action: 'auth.break_glass',
    actorId: user.id,
    targetType: 'user',
    targetId: user.id,
    metadata: { jti, ttlMinutes, email: user.email },
  });

  process.stdout.write(
`Break-glass token minted for ${user.email}
  user id: ${user.id}
  jti:     ${jti}
  ttl:     ${ttlMinutes}m

Set this cookie in your browser dev tools for the Guichet host:
  name:     guichet_token
  value:    ${token}
  path:     /
  httpOnly: (not available from devtools — use an extension or the browser's cookie editor)
  secure:   ${config.COOKIE_SECURE}

Then reload the app. Revoke the session via /api/v1/auth/logout when done.
`,
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[break-glass] Failed:', err);
  process.exit(1);
});
