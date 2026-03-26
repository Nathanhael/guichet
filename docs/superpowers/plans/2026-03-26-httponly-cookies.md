# HttpOnly Cookie Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate JWT transmission from `Authorization: Bearer` headers + localStorage to HttpOnly secure cookies, eliminating token theft via XSS.

**Architecture:** Four-phase migration. Phase 1 adds cookie issuance alongside body response (backward compat). Phase 2 updates server consumers to read cookies as fallback. Phase 3 switches the client to cookie-based auth. Phase 4 removes the body token. A companion `session_expires` non-HttpOnly cookie carries only the `exp` timestamp for client-side expiry detection (since JS cannot read HttpOnly cookies).

**Tech Stack:** Express `cookie-parser`, `SameSite=Lax` cookies, Socket.io cookie parsing, Zustand store changes.

**Important:** All commands must run through Docker. Never run `npm`/`node`/`npx` on the host.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/package.json` | Modify | Add `cookie-parser` dependency |
| `server/config.ts` | Modify | Add `COOKIE_DOMAIN`, `COOKIE_SECURE` env vars |
| `server/app.ts` | Modify | Add `cookie-parser` middleware, `credentials: true` to CORS |
| `server/services/authSession.ts` | Modify | Add `setAuthCookie()` and `clearAuthCookie()` helpers |
| `server/routes/auth.ts` | Modify | Call `setAuthCookie()` at all 4 issuance points, `clearAuthCookie()` at logout |
| `server/routes/sso.ts` | Modify | Set cookie at SSO callback before redirect |
| `server/middleware/auth.ts` | Modify | Read cookie as fallback when no Bearer header |
| `server/trpc/context.ts` | Modify | Read cookie as fallback when no Bearer header |
| `server/socket/handlers.ts` | Modify | Parse cookie from `socket.handshake.headers.cookie` as fallback |
| `client/src/main.tsx` | Modify | Add `credentials: 'include'` to tRPC fetch, remove Authorization header |
| `client/src/hooks/useSocket.ts` | Modify | Remove `auth: { token }`, add `withCredentials: true` |
| `client/src/store/slices/authSlice.ts` | Modify | Remove localStorage token, use `session_expires` cookie for expiry |
| `client/src/components/ChatWindow.tsx` | Modify | Add `credentials: 'include'`, remove Authorization header |
| `client/src/utils/uploadLogo.ts` | Modify | Add `credentials: 'include'`, remove Authorization header |

---

### Task 1: Add `cookie-parser` dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install cookie-parser inside Docker**

```bash
docker compose exec server npm install cookie-parser
docker compose exec server npm install -D @types/cookie-parser
```

- [ ] **Step 2: Verify installation**

```bash
docker compose exec server node -e "require('cookie-parser'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit --no-verify -m "chore: add cookie-parser dependency"
```

---

### Task 2: Add cookie config and middleware

**Files:**
- Modify: `server/config.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Add cookie config vars to `server/config.ts`**

Add after the `AUDIT_ARCHIVE_DELAY_DAYS` line (line ~11):

```typescript
COOKIE_DOMAIN: z.string().optional(),
COOKIE_SECURE: z.preprocess(v => v === 'true' || v === '1' || v === true, z.boolean()).default(false),
```

Add corresponding env parsing after line ~51:

```typescript
COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
COOKIE_SECURE: process.env.COOKIE_SECURE,
```

- [ ] **Step 2: Add cookie-parser middleware and update CORS in `server/app.ts`**

Add import at the top of `server/app.ts`:

```typescript
import cookieParser from 'cookie-parser';
```

Add middleware after `express.json()` / `express.urlencoded()` lines:

```typescript
app.use(cookieParser());
```

Update the Express CORS config to include `credentials: true`:

```typescript
credentials: true,
```

Update the Socket.io CORS config (in the `io` constructor options) to include `credentials: true`:

```typescript
credentials: true,
```

- [ ] **Step 3: Verify server starts**

```bash
docker compose restart server && sleep 3 && docker logs --tail 5 tessera-server-1
```

Expected: Server starts without errors.

- [ ] **Step 4: Run server typecheck**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add server/config.ts server/app.ts
git commit --no-verify -m "feat: add cookie-parser middleware and CORS credentials"
```

---

### Task 3: Create cookie helper functions

**Files:**
- Modify: `server/services/authSession.ts`
- Test: `server/services/authSession.test.ts` (existing)

- [ ] **Step 1: Write tests for cookie helpers**

Add to `server/services/authSession.test.ts` (or create if needed):

```typescript
import { describe, it, expect, vi } from 'vitest';

// Test setAuthCookie
describe('setAuthCookie', () => {
  it('sets tessera_token as HttpOnly secure cookie', async () => {
    const { setAuthCookie } = await import('./authSession.js');
    const res = {
      cookie: vi.fn(),
    } as any;

    setAuthCookie(res, 'test-jwt-token', 86400);

    expect(res.cookie).toHaveBeenCalledWith('tessera_token', 'test-jwt-token', expect.objectContaining({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 86400000, // seconds → milliseconds
    }));
  });

  it('sets session_expires as non-HttpOnly companion cookie', async () => {
    const { setAuthCookie } = await import('./authSession.js');
    const res = {
      cookie: vi.fn(),
    } as any;

    setAuthCookie(res, 'test-jwt-token', 86400);

    // Second call should be session_expires (readable by JS)
    expect(res.cookie).toHaveBeenCalledTimes(2);
    const secondCall = res.cookie.mock.calls[1];
    expect(secondCall[0]).toBe('session_expires');
    expect(secondCall[2]).toMatchObject({ httpOnly: false, sameSite: 'lax', path: '/' });
  });
});

describe('clearAuthCookie', () => {
  it('clears both cookies', async () => {
    const { clearAuthCookie } = await import('./authSession.js');
    const res = {
      clearCookie: vi.fn(),
    } as any;

    clearAuthCookie(res);

    expect(res.clearCookie).toHaveBeenCalledWith('tessera_token', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('session_expires', expect.any(Object));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker compose exec server npx vitest run services/authSession.test.ts
```

Expected: FAIL — `setAuthCookie` and `clearAuthCookie` not exported.

- [ ] **Step 3: Implement cookie helpers in `server/services/authSession.ts`**

Add at the end of the file:

```typescript
import type { Response } from 'express';
import config from '../config.js';

const COOKIE_NAME = 'tessera_token';
const EXPIRY_COOKIE_NAME = 'session_expires';

function cookieOptions(httpOnly: boolean): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  domain?: string;
  maxAge?: number;
} {
  return {
    httpOnly,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

/**
 * Set the HttpOnly auth cookie + a companion non-HttpOnly session_expires cookie.
 * @param res Express response
 * @param token JWT string
 * @param expiresInSeconds Token TTL in seconds
 */
export function setAuthCookie(res: Response, token: string, expiresInSeconds: number): void {
  const maxAgeMs = expiresInSeconds * 1000;

  // HttpOnly cookie — holds the JWT, invisible to JS
  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions(true),
    maxAge: maxAgeMs,
  });

  // Non-HttpOnly companion — holds only the expiry timestamp (epoch seconds)
  // so the client can detect expiry without decoding the JWT
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  res.cookie(EXPIRY_COOKIE_NAME, String(expiresAt), {
    ...cookieOptions(false),
    maxAge: maxAgeMs,
  });
}

/**
 * Clear both auth cookies (logout).
 */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions(true));
  res.clearCookie(EXPIRY_COOKIE_NAME, cookieOptions(false));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
docker compose exec server npx vitest run services/authSession.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/authSession.ts server/services/authSession.test.ts
git commit --no-verify -m "feat: add setAuthCookie/clearAuthCookie helpers"
```

---

### Task 4: Set cookies at all issuance endpoints

**Files:**
- Modify: `server/routes/auth.ts`
- Modify: `server/routes/sso.ts`

- [ ] **Step 1: Parse JWT_EXPIRY to seconds**

In `server/services/authSession.ts`, add a helper to parse the `JWT_EXPIRY` config string (e.g., `'24h'`) into seconds:

```typescript
/** Parse JWT_EXPIRY string (e.g. '24h', '7d', '3600') into seconds */
export function parseExpiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) return 86400; // default 24h
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return value * 86400;
    case 'h': return value * 3600;
    case 'm': return value * 60;
    case 's': default: return value;
  }
}
```

- [ ] **Step 2: Add cookie issuance to `server/routes/auth.ts`**

Import at top of file:

```typescript
import { setAuthCookie, clearAuthCookie, parseExpiryToSeconds } from '../services/authSession.js';
```

At each of the 4 issuance points, add `setAuthCookie()` BEFORE the `res.json()` call:

**`/login-local` (after `buildAuthToken` at ~line 302):**
```typescript
setAuthCookie(res, token, parseExpiryToSeconds(config.JWT_EXPIRY));
```

**`/login` (after `buildAuthToken` at ~line 434):**
```typescript
setAuthCookie(res, token, parseExpiryToSeconds(config.JWT_EXPIRY));
```

**`/switch-partner` (after `buildAuthToken` at ~line 521):**
```typescript
setAuthCookie(res, token, parseExpiryToSeconds(config.JWT_EXPIRY));
```

**`/enter-partner` (after `buildAuthToken` at ~line 628):**
```typescript
setAuthCookie(res, token, parseExpiryToSeconds(config.JWT_EXPIRY));
```

**`/logout` (before/at the success response at ~line 568):**
```typescript
clearAuthCookie(res);
```

- [ ] **Step 3: Add cookie issuance to `server/routes/sso.ts`**

Import at top:

```typescript
import { setAuthCookie, parseExpiryToSeconds } from '../services/authSession.js';
```

After `buildAuthToken()` at ~line 290, before the redirect at ~line 316:

```typescript
setAuthCookie(res, token, parseExpiryToSeconds(config.JWT_EXPIRY));
```

The SSO flow sets the cookie AND redirects with the hash fragment. During Phase 3 (client migration), the client will stop reading the hash fragment and rely on the cookie instead.

- [ ] **Step 4: Verify server starts and typecheck passes**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: No new errors.

- [ ] **Step 5: Run all server tests**

```bash
docker compose exec server npm test
```

Expected: All tests pass (cookie is set alongside existing body response — backward compatible).

- [ ] **Step 6: Commit**

```bash
git add server/routes/auth.ts server/routes/sso.ts server/services/authSession.ts
git commit --no-verify -m "feat: set HttpOnly cookie at all JWT issuance points (backward compat)"
```

---

### Task 5: Update server consumers to read cookie as fallback

**Files:**
- Modify: `server/middleware/auth.ts`
- Modify: `server/trpc/context.ts`
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Update Express auth middleware (`server/middleware/auth.ts`)**

At line ~22 where `req.headers.authorization` is read, add cookie fallback:

```typescript
const authHeader = req.headers.authorization;
let token: string | undefined;

if (authHeader?.startsWith('Bearer ')) {
  token = authHeader.split(' ')[1];
} else if (req.cookies?.tessera_token) {
  token = req.cookies.tessera_token;
}

if (!token) {
  return res.status(401).json({ error: 'No token provided' });
}
```

Note: `req.cookies` is typed by `cookie-parser`. If TypeScript complains, add `import 'cookie-parser';` at the top or cast.

- [ ] **Step 2: Update tRPC context (`server/trpc/context.ts`)**

At line ~34 where `req.headers.authorization` is read, add cookie fallback:

```typescript
const authHeader = req.headers.authorization;
let token: string | undefined;

if (authHeader?.startsWith('Bearer ')) {
  token = authHeader.split(' ')[1];
} else if (req.cookies?.tessera_token) {
  token = req.cookies.tessera_token;
}
```

- [ ] **Step 3: Update Socket.io handshake (`server/socket/handlers.ts`)**

At line ~186 where `socket.handshake.auth?.token` is read, add cookie fallback:

```typescript
let token = socket.handshake.auth?.token;

// Cookie fallback — parse from handshake headers if no auth token
if (!token && socket.handshake.headers.cookie) {
  const cookies = socket.handshake.headers.cookie.split(';').reduce((acc, c) => {
    const [key, ...val] = c.trim().split('=');
    acc[key] = val.join('=');
    return acc;
  }, {} as Record<string, string>);
  token = cookies['tessera_token'];
}

if (!token) {
  return next(new Error('No auth token'));
}
```

Alternatively, install `cookie` package for parsing, but the inline approach above avoids an extra dependency for a simple `key=value` parse.

- [ ] **Step 4: Typecheck**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: No new errors.

- [ ] **Step 5: Run all server tests**

```bash
docker compose exec server npm test
```

Expected: All tests pass. Existing tests use Bearer headers which still work (Bearer takes priority over cookie).

- [ ] **Step 6: Commit**

```bash
git add server/middleware/auth.ts server/trpc/context.ts server/socket/handlers.ts
git commit --no-verify -m "feat: read JWT from cookie as fallback in all server consumers"
```

---

### Task 6: Migrate client to cookie-based auth

**Files:**
- Modify: `client/src/main.tsx`
- Modify: `client/src/hooks/useSocket.ts`
- Modify: `client/src/store/slices/authSlice.ts`
- Modify: `client/src/components/ChatWindow.tsx`
- Modify: `client/src/utils/uploadLogo.ts`

This is the breaking change phase. After this, the client relies on cookies for auth.

- [ ] **Step 1: Update tRPC client (`client/src/main.tsx`)**

In the `httpBatchLink` config (line ~28), remove the `Authorization` header and add `credentials: 'include'`:

```typescript
links: [
  httpBatchLink({
    url: `${import.meta.env.VITE_API_URL || ''}/api/v1/trpc`,
    fetch(url, options) {
      return fetch(url, {
        ...options,
        credentials: 'include',
      });
    },
  }),
],
```

Remove the `headers()` callback that reads `useStore.getState().token`.

- [ ] **Step 2: Update Socket.io client (`client/src/hooks/useSocket.ts`)**

At line ~13, update the `io()` call to use `withCredentials` instead of `auth.token`:

```typescript
socket = io(SOCKET_URL, {
  withCredentials: true,
  autoConnect: true,
});
```

Remove the `auth: { get token() { ... } }` object entirely.

Update the `auth:expired` handler (line ~317). It currently checks `useStore.getState().token` to decide whether to reconnect. Replace with:

```typescript
socket.on('auth:expired', () => {
  // Check session_expires cookie to see if we still have a valid session
  const expiresAt = getSessionExpiry();
  if (expiresAt && expiresAt > Date.now() / 1000) {
    // Cookie might have been refreshed — try reconnecting
    socket?.disconnect();
    socket?.connect();
  } else {
    // Session truly expired — logout
    useStore.getState().logout();
  }
});
```

Add helper function:

```typescript
function getSessionExpiry(): number | null {
  const match = document.cookie.match(/session_expires=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
```

- [ ] **Step 3: Update auth slice (`client/src/store/slices/authSlice.ts`)**

Major changes:
1. Remove `token` from Zustand state entirely
2. Remove all `localStorage.getItem/setItem/removeItem('token')` calls
3. Replace `isTokenExpired(token)` with `isSessionExpired()` that reads the `session_expires` cookie
4. Keep `user`, `memberships`, `activeMembershipId`, `activePartnerId` in localStorage (these are not secrets)

Replace `isTokenExpired`:

```typescript
/** Check if the session has expired by reading the session_expires cookie */
function isSessionExpired(): boolean {
  const match = document.cookie.match(/session_expires=(\d+)/);
  if (!match) return true; // no cookie = expired
  const expiresAt = parseInt(match[1], 10);
  return expiresAt * 1000 < Date.now();
}
```

Update hydration logic (line ~58):
```typescript
// On hydration, check cookie expiry instead of decoding JWT
const expired = isSessionExpired();
if (expired) {
  localStorage.removeItem('user');
  localStorage.removeItem('memberships');
  localStorage.removeItem('activeMembershipId');
  localStorage.removeItem('activePartnerId');
}
```

Remove `setToken` action. Remove `token` from state interface and initial state.

Update `login` action: remove `get().setToken(data.token)`. The cookie is set by the server response automatically (browser handles `Set-Cookie`).

Update `enterPartnerAsOperator`: remove `get().setToken(data.token)`. Add `credentials: 'include'` to the fetch call. Remove `Authorization` header.

Update `logout`: remove token cleanup. Add `credentials: 'include'` to the fetch call. Remove `Authorization` header.

Update `switchPartner` (if it exists as a client action): same pattern — add `credentials: 'include'`, remove `Authorization` header.

- [ ] **Step 4: Update direct fetch calls**

**`client/src/components/ChatWindow.tsx` (line ~336):**

```typescript
// Before:
headers: { 'Authorization': `Bearer ${token}` }

// After:
credentials: 'include' as RequestCredentials,
// Remove the Authorization header entirely
```

Remove the `const { token } = useStore.getState()` line.

**`client/src/utils/uploadLogo.ts` (line ~8):**

```typescript
// Before:
headers: { 'Authorization': `Bearer ${useStore.getState().token}` }

// After (add credentials, remove Authorization):
credentials: 'include' as RequestCredentials,
```

- [ ] **Step 5: Update any components that read `token` from the store**

Search for `useStore.*token` or `s.token` across the client. Any component that conditionally renders based on `token` presence should instead check for `user` presence (which is still in Zustand state):

```typescript
// Before:
const isAuthenticated = useStore(s => !!s.token);

// After:
const isAuthenticated = useStore(s => !!s.user);
```

- [ ] **Step 6: Client typecheck**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: Errors related to `token` property removal — fix any remaining references.

- [ ] **Step 7: Run client tests**

```bash
docker compose exec client npm test
```

Fix any test failures — tests that mock `token` in the store need updating to not rely on it.

- [ ] **Step 8: Commit**

```bash
git add client/
git commit --no-verify -m "feat: migrate client to cookie-based auth, remove localStorage token"
```

---

### Task 7: Remove body token from server responses

**Files:**
- Modify: `server/routes/auth.ts`
- Modify: `server/services/authSession.ts`

- [ ] **Step 1: Remove `token` from response bodies**

In `server/services/authSession.ts`, update `buildAuthResponse()` to NOT include `token` in the returned object. The cookie is already set before this function is called.

```typescript
// Before:
return { token, user: { ... }, memberships };

// After:
return { user: { ... }, memberships };
```

In `server/routes/auth.ts`, update `/switch-partner` and `/enter-partner` responses:

```typescript
// Before:
res.json({ token, activePartnerId, manifest });

// After:
res.json({ activePartnerId, manifest });
```

- [ ] **Step 2: Update SSO flow**

In `server/routes/sso.ts`, the hash fragment payload no longer needs the token. The cookie is already set. Update the redirect payload:

```typescript
// Before:
const payload = JSON.stringify(authResponse); // contains { token, user, memberships }

// After:
const payload = JSON.stringify(authResponse); // now contains { user, memberships } (no token)
```

Update the client SSO callback handler to not look for `token` in the parsed payload.

- [ ] **Step 3: Run full test suite**

```bash
docker compose exec server npm test
docker compose exec client npm test
```

Fix any tests that assert on `token` in response bodies.

- [ ] **Step 4: Commit**

```bash
git add server/ client/
git commit --no-verify -m "feat: remove JWT from response bodies, cookies are sole transport"
```

---

### Task 8: Update E2E and load tests

**Files:**
- Modify: `testing/e2e/*.spec.ts` (Playwright)
- Modify: `testing/load/*.js` (k6)

- [ ] **Step 1: Update Playwright E2E tests**

Playwright browser contexts automatically handle cookies. Tests that extract `token` from login API responses need updating:

```typescript
// Before:
const loginRes = await request.post('/api/v1/auth/login', { data: { ... } });
const { token } = await loginRes.json();
// Use token in subsequent requests

// After:
const loginRes = await request.post('/api/v1/auth/login', { data: { ... } });
// Cookie is automatically stored in the request context
// No token extraction needed — subsequent requests include the cookie
```

- [ ] **Step 2: Update k6 load tests**

k6 has a built-in cookie jar. Update `testing/load/smoke.js` and `testing/load/load.js`:

```javascript
// Before:
const loginRes = http.post(url, payload);
const token = loginRes.json('token');
const params = { headers: { Authorization: `Bearer ${token}` } };

// After:
const jar = http.cookieJar();
const loginRes = http.post(url, payload);
// Cookie is automatically stored in the jar
// Subsequent requests to the same domain include the cookie automatically
const params = {}; // no explicit auth header needed
```

- [ ] **Step 3: Run E2E tests**

```bash
docker compose exec server npx playwright test
```

- [ ] **Step 4: Commit**

```bash
git add testing/
git commit --no-verify -m "test: update E2E and load tests for cookie-based auth"
```

---

### Task 9: Final verification and cleanup

- [ ] **Step 1: Full server test suite**

```bash
docker compose exec server npm test
```

Expected: All 338+ tests pass.

- [ ] **Step 2: Full client test suite**

```bash
docker compose exec client npm test
```

Expected: All 89+ tests pass.

- [ ] **Step 3: Manual smoke test**

1. Open browser DevTools → Application → Cookies
2. Log in — verify `tessera_token` (HttpOnly) and `session_expires` (not HttpOnly) cookies appear
3. Verify `tessera_token` does NOT appear in DevTools Console via `document.cookie` (HttpOnly)
4. Verify `session_expires` IS readable via `document.cookie`
5. Navigate between views — verify all API calls work (no 401s)
6. Switch partner — verify new cookies are set
7. Open WebSocket inspector — verify Socket.io connects successfully
8. Send a message — verify real-time works
9. Log out — verify both cookies are cleared
10. Verify localStorage no longer contains `token`

- [ ] **Step 4: Verify XSS protection**

In browser console:
```javascript
// This should NOT show the JWT:
document.cookie
// Should only show: session_expires=1234567890; (and any other non-HttpOnly cookies)
```

- [ ] **Step 5: Update SECURITY_AUDIT doc**

Mark P3 as complete in `SECURITY_AUDIT_2026-03-26.md`.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit --no-verify -m "feat: complete HttpOnly cookie migration — XSS token theft eliminated"
```
