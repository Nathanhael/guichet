# Login Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic LoginView with an email-first auth flow using composable step components, theme toggle, and a new `/api/v1/auth/lookup` endpoint.

**Architecture:** State machine in LoginView drives which step component renders (`email` → `password` | `sso-redirect` | `reset` → `partner-picker`). New server endpoint determines auth method from email without leaking account existence. Existing CSS design tokens (`--color-bg-base`, `--color-border`, etc.) and Tailwind utility classes (`mono-label`, `btn-primary`, `input-field`) are reused — no new tokens needed.

**Tech Stack:** React 19, TypeScript, Vitest + jsdom, Tailwind CSS 4, Express, Drizzle ORM

**Key references:**
- Design spec: `docs/superpowers/specs/2026-04-04-login-page-design.md`
- Current LoginView: `client/src/views/LoginView.tsx` (~800 lines, to be rewritten)
- Auth routes: `server/routes/auth.ts`
- CSS tokens: `client/src/index.css` (`@theme` block)
- Auth slice: `client/src/store/slices/authSlice.ts`
- Test helpers: `client/src/test/helpers.tsx`
- Existing DarkModeToggle: `client/src/components/DarkModeToggle.tsx`

**Docker commands:** All commands run through Docker. Never run `npm`/`node`/`npx` on the host.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server/routes/__tests__/auth-lookup.test.ts` | Tests for the lookup endpoint |
| `client/src/components/login/EmailStep.tsx` | Email input + Continue button |
| `client/src/components/login/PasswordStep.tsx` | Password input + Sign In + SSO link |
| `client/src/components/login/ResetStep.tsx` | Password reset request form |
| `client/src/components/login/PartnerPicker.tsx` | Multi-partner selection screen |
| `client/src/components/login/StatusFooter.tsx` | Version, status dot, links |
| `client/src/components/login/ErrorBanner.tsx` | Server error banner (top of card) |
| `client/src/components/login/index.ts` | Barrel exports |
| `client/src/components/login/__tests__/EmailStep.test.tsx` | EmailStep tests |
| `client/src/components/login/__tests__/PasswordStep.test.tsx` | PasswordStep tests |
| `client/src/components/login/__tests__/ResetStep.test.tsx` | ResetStep tests |
| `client/src/components/login/__tests__/PartnerPicker.test.tsx` | PartnerPicker tests |
| `client/src/views/__tests__/LoginView.test.tsx` | LoginView state machine tests |

### Modified files

| File | Changes |
|------|---------|
| `server/routes/auth.ts` | Add `POST /api/v1/auth/lookup` endpoint |
| `client/src/views/LoginView.tsx` | Rewrite: state machine + step components |
| `client/src/types/index.ts` | Add `LookupResponse` type |

### Preserved functionality

The current LoginView handles demo login, MFA, and SSO callbacks. These are preserved:
- **Demo login:** Kept as a "Demo" link in StatusFooter → toggles `?demo=true` query param → shows legacy demo card
- **MFA flow:** Server returns `{ mfaRequired: true }` → LoginView transitions to existing MFA step (not refactored, out of scope per spec)
- **SSO callback:** URL hash `#sso_callback=` handling stays in LoginView's `useEffect`

---

## Task 1: Server — Add `/api/v1/auth/lookup` endpoint

**Files:**
- Modify: `server/routes/auth.ts`
- Create: `server/routes/__tests__/auth-lookup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/routes/__tests__/auth-lookup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock database
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockInnerJoin = vi.fn();

vi.mock('../../db.js', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));

vi.mock('../../db/schema.js', () => ({
  users: { id: 'id', email: 'email' },
  memberships: { userId: 'userId', partnerId: 'partnerId' },
  partners: { id: 'id', authMethod: 'authMethod', status: 'status' },
}));

vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config.js', () => ({
  default: {
    DISABLE_RATE_LIMIT: true,
    CORS_ORIGIN: 'http://localhost:5173',
    COOKIE_SECURE: false,
    COOKIE_DOMAIN: '',
    JWT_SECRET: 'test-secret',
    ACCESS_TOKEN_EXPIRY: '15m',
    REFRESH_TOKEN_EXPIRY: '7d',
  },
}));

describe('POST /api/v1/auth/lookup', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    const { default: authRouter } = await import('../auth.js');
    app.use('/api/v1/auth', authRouter);
  });

  it('returns local auth method for unknown email (does not leak existence)', async () => {
    // Mock: user not found
    mockFrom.mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await request(app)
      .post('/api/v1/auth/lookup')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authMethods: ['local'],
      partnerCount: 0,
    });
  });

  it('returns local for single local-only partner', async () => {
    mockFrom.mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { authMethod: 'local', status: 'active' },
          ]),
        }),
      }),
    });

    const res = await request(app)
      .post('/api/v1/auth/lookup')
      .send({ email: 'user@acme.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authMethods: ['local'],
      partnerCount: 1,
    });
  });

  it('returns sso for single SSO-only partner', async () => {
    mockFrom.mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { authMethod: 'sso', status: 'active' },
          ]),
        }),
      }),
    });

    const res = await request(app)
      .post('/api/v1/auth/lookup')
      .send({ email: 'user@sso-corp.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authMethods: ['sso'],
      partnerCount: 1,
    });
  });

  it('returns both methods for partner with authMethod=both', async () => {
    mockFrom.mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { authMethod: 'both', status: 'active' },
          ]),
        }),
      }),
    });

    const res = await request(app)
      .post('/api/v1/auth/lookup')
      .send({ email: 'user@mixed.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authMethods: ['local', 'sso'],
      partnerCount: 1,
    });
  });

  it('returns combined methods for multi-partner user', async () => {
    mockFrom.mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { authMethod: 'local', status: 'active' },
            { authMethod: 'sso', status: 'active' },
          ]),
        }),
      }),
    });

    const res = await request(app)
      .post('/api/v1/auth/lookup')
      .send({ email: 'user@multi.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authMethods: ['local', 'sso'],
      partnerCount: 2,
    });
  });

  it('filters out inactive partners', async () => {
    mockFrom.mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { authMethod: 'local', status: 'inactive' },
          ]),
        }),
      }),
    });

    const res = await request(app)
      .post('/api/v1/auth/lookup')
      .send({ email: 'user@dead.com' });

    expect(res.status).toBe(200);
    // Inactive partners filtered out → looks like unknown user
    expect(res.body).toEqual({
      authMethods: ['local'],
      partnerCount: 0,
    });
  });

  it('returns 400 for missing email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/lookup')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/lookup')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec server npx vitest run routes/__tests__/auth-lookup.test.ts --reporter verbose
```

Expected: FAIL — endpoint does not exist yet.

- [ ] **Step 3: Implement the lookup endpoint**

Add to `server/routes/auth.ts`, near the other `POST` routes:

```typescript
// Email lookup — determines auth method without leaking account existence
const lookupSchema = z.object({ email: z.string().email() });

router.post('/lookup',
  validateBody(lookupSchema),
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      // Find all active partner memberships for this email
      const rows = await db
        .select({
          authMethod: partners.authMethod,
          status: partners.status,
        })
        .from(users)
        .innerJoin(memberships, eq(users.id, memberships.userId))
        .innerJoin(partners, eq(memberships.partnerId, partners.id))
        .where(eq(users.email, email.toLowerCase()));

      // Filter to active partners only
      const activeRows = rows.filter((r) => r.status === 'active');

      if (activeRows.length === 0) {
        // Don't reveal whether email exists — return default local
        return res.json({ authMethods: ['local'], partnerCount: 0 });
      }

      // Collect unique auth methods across all active partners
      const methods = new Set<string>();
      for (const row of activeRows) {
        if (row.authMethod === 'both') {
          methods.add('local');
          methods.add('sso');
        } else {
          methods.add(row.authMethod);
        }
      }

      return res.json({
        authMethods: Array.from(methods),
        partnerCount: activeRows.length,
      });
    } catch (err) {
      logger.error({ err }, 'Lookup failed');
      // On error, return default to not leak info
      return res.json({ authMethods: ['local'], partnerCount: 0 });
    }
  }
);
```

Add required imports at the top of `auth.ts` if not already present. The file already imports `eq` from `drizzle-orm`, `users`, `memberships`, `partners` from `../db/schema.js`, `db` from `../db.js`, `z` from `zod`, and `validateBody` from `../middleware/validator.js`. Verify these exist before adding duplicates.

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec server npx vitest run routes/__tests__/auth-lookup.test.ts --reporter verbose
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/routes/__tests__/auth-lookup.test.ts
git commit -m "feat: add POST /api/v1/auth/lookup for email-first login flow"
```

---

## Task 2: Client — Add `LookupResponse` type

**Files:**
- Modify: `client/src/types/index.ts`

- [ ] **Step 1: Add the type**

Add to the end of `client/src/types/index.ts`:

```typescript
/** Response from POST /api/v1/auth/lookup */
export interface LookupResponse {
  authMethods: ('local' | 'sso')[];
  partnerCount: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat: add LookupResponse type for email-first login"
```

---

## Task 3: Client — Create `ErrorBanner` component

**Files:**
- Create: `client/src/components/login/ErrorBanner.tsx`
- Create: `client/src/components/login/__tests__/ErrorBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/login/__tests__/ErrorBanner.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBanner from '../ErrorBanner';

describe('ErrorBanner', () => {
  it('renders the error message', () => {
    render(<ErrorBanner message="Invalid email or password" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('renders nothing when message is empty', () => {
    const { container } = render(<ErrorBanner message="" />);
    expect(container.firstChild).toBeNull();
  });

  it('has correct accessibility role', () => {
    render(<ErrorBanner message="Error" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/ErrorBanner.test.tsx --reporter verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement ErrorBanner**

Create `client/src/components/login/ErrorBanner.tsx`:

```tsx
interface ErrorBannerProps {
  message: string;
}

export default function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="mb-4 border-l-2 border-[var(--color-accent-red)] bg-[var(--color-bg-elevated)] px-3 py-2 font-sans text-sm text-[var(--color-accent-red)]"
    >
      {message}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/ErrorBanner.test.tsx --reporter verbose
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/login/ErrorBanner.tsx client/src/components/login/__tests__/ErrorBanner.test.tsx
git commit -m "feat: add ErrorBanner component for login page"
```

---

## Task 4: Client — Create `EmailStep` component

**Files:**
- Create: `client/src/components/login/EmailStep.tsx`
- Create: `client/src/components/login/__tests__/EmailStep.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/login/__tests__/EmailStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmailStep from '../EmailStep';

// Mock useT
vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

describe('EmailStep', () => {
  const onLookupResult = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders email input and continue button', () => {
    render(<EmailStep onLookupResult={onLookupResult} />);
    expect(screen.getByPlaceholderText('login_email_placeholder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'login_continue' })).toBeInTheDocument();
  });

  it('shows inline error when email is empty on submit', async () => {
    render(<EmailStep onLookupResult={onLookupResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'login_continue' }));
    expect(await screen.findByText('login_email_required')).toBeInTheDocument();
    expect(onLookupResult).not.toHaveBeenCalled();
  });

  it('shows inline error for invalid email format', async () => {
    render(<EmailStep onLookupResult={onLookupResult} />);
    fireEvent.change(screen.getByPlaceholderText('login_email_placeholder'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_continue' }));
    expect(await screen.findByText('login_email_invalid')).toBeInTheDocument();
    expect(onLookupResult).not.toHaveBeenCalled();
  });

  it('calls onLookupResult with server response on valid email', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ authMethods: ['local'], partnerCount: 1 }),
    });

    render(<EmailStep onLookupResult={onLookupResult} />);
    fireEvent.change(screen.getByPlaceholderText('login_email_placeholder'), {
      target: { value: 'user@acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_continue' }));

    await waitFor(() => {
      expect(onLookupResult).toHaveBeenCalledWith(
        'user@acme.com',
        { authMethods: ['local'], partnerCount: 1 }
      );
    });
  });

  it('disables button while loading', async () => {
    let resolvePromise: (value: unknown) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => { resolvePromise = resolve; })
    );

    render(<EmailStep onLookupResult={onLookupResult} />);
    fireEvent.change(screen.getByPlaceholderText('login_email_placeholder'), {
      target: { value: 'user@acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_continue' }));

    expect(screen.getByRole('button', { name: 'login_continue' })).toBeDisabled();

    // Clean up
    resolvePromise!({ ok: true, json: () => Promise.resolve({ authMethods: ['local'], partnerCount: 0 }) });
  });

  it('pre-fills email from initialEmail prop', () => {
    render(<EmailStep onLookupResult={onLookupResult} initialEmail="pre@fill.com" />);
    expect(screen.getByPlaceholderText('login_email_placeholder')).toHaveValue('pre@fill.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/EmailStep.test.tsx --reporter verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement EmailStep**

Create `client/src/components/login/EmailStep.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useT } from '../../i18n';
import type { LookupResponse } from '../../types';

interface EmailStepProps {
  onLookupResult: (email: string, result: LookupResponse) => void;
  initialEmail?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailStep({ onLookupResult, initialEmail = '' }: EmailStepProps) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = email.trim();
    if (!trimmed) {
      setError(t('login_email_required'));
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setError(t('login_email_invalid'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
        credentials: 'include',
      });

      if (!res.ok) {
        setError(t('login_lookup_error'));
        return;
      }

      const data: LookupResponse = await res.json();
      onLookupResult(trimmed, data);
    } catch {
      setError(t('login_lookup_error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label
          htmlFor="login-email"
          className="mono-label mb-1.5 block text-[9px] uppercase text-[var(--color-text-muted)]"
        >
          {t('login_email_label')}
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          autoFocus
          className="input-field w-full"
          placeholder={t('login_email_placeholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && (
          <p className="mt-1 font-sans text-xs text-[var(--color-accent-red)]">{error}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={loading}
        aria-label={t('login_continue')}
        className="btn-primary w-full py-3 text-xs"
      >
        {t('login_continue')}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/EmailStep.test.tsx --reporter verbose
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/login/EmailStep.tsx client/src/components/login/__tests__/EmailStep.test.tsx
git commit -m "feat: add EmailStep component for email-first login"
```

---

## Task 5: Client — Create `PasswordStep` component

**Files:**
- Create: `client/src/components/login/PasswordStep.tsx`
- Create: `client/src/components/login/__tests__/PasswordStep.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/login/__tests__/PasswordStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PasswordStep from '../PasswordStep';

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

describe('PasswordStep', () => {
  const defaultProps = {
    email: 'user@acme.com',
    showSsoOption: false,
    onLogin: vi.fn(),
    onForgot: vi.fn(),
    onChangeEmail: vi.fn(),
    onSsoLogin: vi.fn(),
    onBannerError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders email as read-only with change link', () => {
    render(<PasswordStep {...defaultProps} />);
    expect(screen.getByText('user@acme.com')).toBeInTheDocument();
    expect(screen.getByText('login_change_email')).toBeInTheDocument();
  });

  it('calls onChangeEmail when change link is clicked', () => {
    render(<PasswordStep {...defaultProps} />);
    fireEvent.click(screen.getByText('login_change_email'));
    expect(defaultProps.onChangeEmail).toHaveBeenCalled();
  });

  it('shows inline error when password is empty', async () => {
    render(<PasswordStep {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'login_sign_in' }));
    expect(await screen.findByText('login_password_required')).toBeInTheDocument();
  });

  it('calls onLogin with user data on successful login', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        user: { id: 'u1', name: 'Test' },
        memberships: [{ id: 'm1', partnerId: 'p1', role: 'agent' }],
      }),
    });

    render(<PasswordStep {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('login_password_placeholder'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_sign_in' }));

    await waitFor(() => {
      expect(defaultProps.onLogin).toHaveBeenCalledWith({
        user: { id: 'u1', name: 'Test' },
        memberships: [{ id: 'm1', partnerId: 'p1', role: 'agent' }],
      });
    });
  });

  it('calls onBannerError on invalid credentials', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Invalid email or password' }),
    });

    render(<PasswordStep {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('login_password_placeholder'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_sign_in' }));

    await waitFor(() => {
      expect(defaultProps.onBannerError).toHaveBeenCalledWith('Invalid email or password');
    });
  });

  it('calls onForgot when forgot link is clicked', () => {
    render(<PasswordStep {...defaultProps} />);
    fireEvent.click(screen.getByText('login_forgot'));
    expect(defaultProps.onForgot).toHaveBeenCalled();
  });

  it('shows SSO option when showSsoOption is true', () => {
    render(<PasswordStep {...defaultProps} showSsoOption />);
    expect(screen.getByText('login_sso_option')).toBeInTheDocument();
  });

  it('hides SSO option when showSsoOption is false', () => {
    render(<PasswordStep {...defaultProps} showSsoOption={false} />);
    expect(screen.queryByText('login_sso_option')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/PasswordStep.test.tsx --reporter verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement PasswordStep**

Create `client/src/components/login/PasswordStep.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useT } from '../../i18n';
import { Eye, EyeOff } from 'lucide-react';
import type { User, Membership } from '../../types';

interface LoginResult {
  user: User;
  memberships: Membership[];
  mfaRequired?: boolean;
  mfaEndpoint?: string;
  mfaBody?: Record<string, unknown>;
}

interface PasswordStepProps {
  email: string;
  showSsoOption: boolean;
  onLogin: (result: LoginResult) => void;
  onForgot: () => void;
  onChangeEmail: () => void;
  onSsoLogin: () => void;
  onBannerError: (message: string) => void;
}

export default function PasswordStep({
  email,
  showSsoOption,
  onLogin,
  onForgot,
  onChangeEmail,
  onSsoLogin,
  onBannerError,
}: PasswordStepProps) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    onBannerError('');

    if (!password) {
      setError(t('login_password_required'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe: false }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.error || data.message || t('login_invalid_credentials');
        onBannerError(msg);
        return;
      }

      // Handle MFA challenge
      if (data.mfaRequired) {
        onLogin({
          user: data.user ?? ({} as User),
          memberships: data.memberships ?? [],
          mfaRequired: true,
          mfaEndpoint: '/api/v1/auth/login-local',
          mfaBody: { email, password },
        });
        return;
      }

      onLogin({ user: data.user, memberships: data.memberships || [] });
    } catch {
      onBannerError(t('login_network_error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Read-only email */}
      <div className="mb-4 flex items-center justify-between">
        <span className="font-sans text-sm text-[var(--color-text-primary)]">{email}</span>
        <button
          type="button"
          onClick={onChangeEmail}
          className="font-mono text-[10px] text-[var(--color-accent-blue)] hover:underline"
        >
          {t('login_change_email')}
        </button>
      </div>

      {/* Password field */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label
            htmlFor="login-password"
            className="mono-label text-[9px] uppercase text-[var(--color-text-muted)]"
          >
            {t('login_password_label')}
          </label>
          <button
            type="button"
            onClick={onForgot}
            className="font-mono text-[10px] text-[var(--color-accent-blue)] hover:underline"
          >
            {t('login_forgot')}
          </button>
        </div>
        <div className="relative">
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            className="input-field w-full pr-10"
            placeholder={t('login_password_placeholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--color-text-muted)]"
            aria-label={showPassword ? t('login_hide_password') : t('login_show_password')}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error && (
          <p className="mt-1 font-sans text-xs text-[var(--color-accent-red)]">{error}</p>
        )}
      </div>

      {/* Sign In button */}
      <button
        type="submit"
        disabled={loading}
        aria-label={t('login_sign_in')}
        className="btn-primary w-full py-3 text-xs"
      >
        {t('login_sign_in')}
      </button>

      {/* SSO option */}
      {showSsoOption && (
        <>
          <div className="my-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-[var(--color-border)]" />
            <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
              {t('login_or')}
            </span>
            <div className="h-px flex-1 bg-[var(--color-border)]" />
          </div>
          <button
            type="button"
            onClick={onSsoLogin}
            className="btn-secondary w-full py-3 text-xs"
          >
            {t('login_sso_option')}
          </button>
        </>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/PasswordStep.test.tsx --reporter verbose
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/login/PasswordStep.tsx client/src/components/login/__tests__/PasswordStep.test.tsx
git commit -m "feat: add PasswordStep component for login page"
```

---

## Task 6: Client — Create `ResetStep` component

**Files:**
- Create: `client/src/components/login/ResetStep.tsx`
- Create: `client/src/components/login/__tests__/ResetStep.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/login/__tests__/ResetStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResetStep from '../ResetStep';

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

describe('ResetStep', () => {
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders with pre-filled email', () => {
    render(<ResetStep email="user@acme.com" onBack={onBack} />);
    expect(screen.getByDisplayValue('user@acme.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'login_send_reset' })).toBeInTheDocument();
  });

  it('renders heading and back link', () => {
    render(<ResetStep email="user@acme.com" onBack={onBack} />);
    expect(screen.getByText('login_reset_heading')).toBeInTheDocument();
    expect(screen.getByText('login_back_to_login')).toBeInTheDocument();
  });

  it('calls onBack when back link is clicked', () => {
    render(<ResetStep email="user@acme.com" onBack={onBack} />);
    fireEvent.click(screen.getByText('login_back_to_login'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows success message after successful reset request', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(<ResetStep email="user@acme.com" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'login_send_reset' }));

    expect(await screen.findByText('login_reset_success')).toBeInTheDocument();
  });

  it('shows error on failed reset request', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Too many attempts' }),
    });

    render(<ResetStep email="user@acme.com" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'login_send_reset' }));

    await waitFor(() => {
      expect(screen.getByText('Too many attempts')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/ResetStep.test.tsx --reporter verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement ResetStep**

Create `client/src/components/login/ResetStep.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useT } from '../../i18n';

interface ResetStepProps {
  email: string;
  onBack: () => void;
}

export default function ResetStep({ email, onBack }: ResetStepProps) {
  const t = useT();
  const [resetEmail, setResetEmail] = useState(email);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim() }),
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || data.message || t('login_reset_error'));
        return;
      }

      setSuccess(true);
    } catch {
      setError(t('login_network_error'));
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="text-center">
        <p className="mb-4 font-sans text-sm text-[var(--color-text-primary)]">
          {t('login_reset_success')}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[10px] text-[var(--color-accent-blue)] hover:underline"
        >
          {t('login_back_to_login')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3 className="mb-4 font-mono text-sm font-bold uppercase text-[var(--color-text-primary)]">
        {t('login_reset_heading')}
      </h3>

      <div className="mb-4">
        <label
          htmlFor="reset-email"
          className="mono-label mb-1.5 block text-[9px] uppercase text-[var(--color-text-muted)]"
        >
          {t('login_email_label')}
        </label>
        <input
          id="reset-email"
          type="email"
          autoComplete="email"
          className="input-field w-full"
          value={resetEmail}
          onChange={(e) => setResetEmail(e.target.value)}
        />
        {error && (
          <p className="mt-1 font-sans text-xs text-[var(--color-accent-red)]">{error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        aria-label={t('login_send_reset')}
        className="btn-primary mb-3 w-full py-3 text-xs"
      >
        {t('login_send_reset')}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="block w-full text-center font-mono text-[10px] text-[var(--color-accent-blue)] hover:underline"
      >
        {t('login_back_to_login')}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/ResetStep.test.tsx --reporter verbose
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/login/ResetStep.tsx client/src/components/login/__tests__/ResetStep.test.tsx
git commit -m "feat: add ResetStep component for login page"
```

---

## Task 7: Client — Create `PartnerPicker` component

**Files:**
- Create: `client/src/components/login/PartnerPicker.tsx`
- Create: `client/src/components/login/__tests__/PartnerPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/login/__tests__/PartnerPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PartnerPicker from '../PartnerPicker';
import type { Membership } from '../../../types';

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

const mockMemberships: Membership[] = [
  {
    id: 'm1',
    userId: 'u1',
    partnerId: 'p1',
    partnerName: 'Acme Corp',
    role: 'admin',
    departments: [],
    partnerStatus: 'active',
  },
  {
    id: 'm2',
    userId: 'u1',
    partnerId: 'p2',
    partnerName: 'Widget Inc',
    role: 'support',
    departments: [],
    partnerStatus: 'active',
  },
  {
    id: 'm3',
    userId: 'u1',
    partnerId: 'p3',
    partnerName: 'Dead Corp',
    role: 'agent',
    departments: [],
    partnerStatus: 'inactive',
  },
];

describe('PartnerPicker', () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all memberships', () => {
    render(<PartnerPicker memberships={mockMemberships} onSelect={onSelect} />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Widget Inc')).toBeInTheDocument();
    expect(screen.getByText('Dead Corp')).toBeInTheDocument();
  });

  it('shows heading', () => {
    render(<PartnerPicker memberships={mockMemberships} onSelect={onSelect} />);
    expect(screen.getByText('login_select_org')).toBeInTheDocument();
  });

  it('calls onSelect with membership when active partner is clicked', () => {
    render(<PartnerPicker memberships={mockMemberships} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Acme Corp'));
    expect(onSelect).toHaveBeenCalledWith(mockMemberships[0]);
  });

  it('does not call onSelect for inactive partner', () => {
    render(<PartnerPicker memberships={mockMemberships} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Dead Corp'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows inactive badge for inactive partners', () => {
    render(<PartnerPicker memberships={mockMemberships} onSelect={onSelect} />);
    expect(screen.getByText('login_inactive')).toBeInTheDocument();
  });

  it('shows role badges', () => {
    render(<PartnerPicker memberships={mockMemberships} onSelect={onSelect} />);
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    expect(screen.getByText('SUPPORT')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/PartnerPicker.test.tsx --reporter verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement PartnerPicker**

Create `client/src/components/login/PartnerPicker.tsx`:

```tsx
import { useT } from '../../i18n';
import type { Membership } from '../../types';

interface PartnerPickerProps {
  memberships: Membership[];
  onSelect: (membership: Membership) => void;
}

export default function PartnerPicker({ memberships, onSelect }: PartnerPickerProps) {
  const t = useT();

  return (
    <div>
      <h3 className="mb-4 font-mono text-sm font-bold uppercase text-[var(--color-text-primary)]">
        {t('login_select_org')}
      </h3>

      <div className="flex flex-col gap-2">
        {memberships.map((m) => {
          const isActive = m.partnerStatus === 'active';
          return (
            <button
              key={m.id}
              type="button"
              disabled={!isActive}
              onClick={() => isActive && onSelect(m)}
              className={`flex items-center justify-between border p-3 text-left transition-none ${
                isActive
                  ? 'border-[var(--color-border)] hover:border-[var(--color-accent-blue)] cursor-pointer'
                  : 'border-[var(--color-border)] opacity-50 cursor-not-allowed'
              }`}
            >
              <div>
                <span className="font-sans text-sm font-medium text-[var(--color-text-primary)]">
                  {m.partnerName}
                </span>
                <span className="ml-2 font-mono text-[9px] uppercase text-[var(--color-text-muted)]">
                  {m.role.toUpperCase()}
                </span>
              </div>
              {!isActive && (
                <span className="font-mono text-[9px] uppercase text-[var(--color-accent-red)]">
                  {t('login_inactive')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/PartnerPicker.test.tsx --reporter verbose
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/login/PartnerPicker.tsx client/src/components/login/__tests__/PartnerPicker.test.tsx
git commit -m "feat: add PartnerPicker component for multi-partner login"
```

---

## Task 8: Client — Create `StatusFooter` component

**Files:**
- Create: `client/src/components/login/StatusFooter.tsx`
- Create: `client/src/components/login/__tests__/StatusFooter.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/login/__tests__/StatusFooter.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StatusFooter from '../StatusFooter';

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

describe('StatusFooter', () => {
  const onLegalClick = vi.fn();
  const onDemoClick = vi.fn();

  it('renders version number', () => {
    render(<StatusFooter version="2.0.0" onLegalClick={onLegalClick} />);
    expect(screen.getByText('v2.0.0')).toBeInTheDocument();
  });

  it('renders system status indicator', () => {
    render(<StatusFooter version="2.0.0" onLegalClick={onLegalClick} />);
    expect(screen.getByText('login_systems_operational')).toBeInTheDocument();
  });

  it('renders legal link', () => {
    render(<StatusFooter version="2.0.0" onLegalClick={onLegalClick} />);
    fireEvent.click(screen.getByText('login_legal'));
    expect(onLegalClick).toHaveBeenCalled();
  });

  it('renders demo link when showDemo is true', () => {
    render(
      <StatusFooter version="2.0.0" onLegalClick={onLegalClick} showDemo onDemoClick={onDemoClick} />
    );
    fireEvent.click(screen.getByText('login_demo'));
    expect(onDemoClick).toHaveBeenCalled();
  });

  it('hides demo link when showDemo is false', () => {
    render(<StatusFooter version="2.0.0" onLegalClick={onLegalClick} />);
    expect(screen.queryByText('login_demo')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/StatusFooter.test.tsx --reporter verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement StatusFooter**

Create `client/src/components/login/StatusFooter.tsx`:

```tsx
import { useT } from '../../i18n';

interface StatusFooterProps {
  version: string;
  onLegalClick: () => void;
  showDemo?: boolean;
  onDemoClick?: () => void;
}

export default function StatusFooter({ version, onLegalClick, showDemo, onDemoClick }: StatusFooterProps) {
  const t = useT();

  return (
    <div className="mt-7 text-center">
      <div className="mb-2 flex items-center justify-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-green)]" />
        <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
          {t('login_systems_operational')}
        </span>
      </div>
      <div className="flex items-center justify-center gap-3">
        <span className="font-mono text-[10px] text-[var(--color-text-faint)]">v{version}</span>
        <button
          type="button"
          onClick={onLegalClick}
          className="font-mono text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-accent-blue)]"
        >
          {t('login_legal')}
        </button>
        {showDemo && onDemoClick && (
          <button
            type="button"
            onClick={onDemoClick}
            className="font-mono text-[10px] text-[var(--color-accent-blue)] hover:underline"
          >
            {t('login_demo')}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec client npx vitest run src/components/login/__tests__/StatusFooter.test.tsx --reporter verbose
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/login/StatusFooter.tsx client/src/components/login/__tests__/StatusFooter.test.tsx
git commit -m "feat: add StatusFooter component for login page"
```

---

## Task 9: Client — Create barrel export

**Files:**
- Create: `client/src/components/login/index.ts`

- [ ] **Step 1: Create barrel export**

Create `client/src/components/login/index.ts`:

```typescript
export { default as EmailStep } from './EmailStep';
export { default as PasswordStep } from './PasswordStep';
export { default as ResetStep } from './ResetStep';
export { default as PartnerPicker } from './PartnerPicker';
export { default as StatusFooter } from './StatusFooter';
export { default as ErrorBanner } from './ErrorBanner';
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/login/index.ts
git commit -m "feat: add login components barrel export"
```

---

## Task 10: Client — Rewrite LoginView with state machine

**Files:**
- Modify: `client/src/views/LoginView.tsx` (full rewrite)
- Create: `client/src/views/__tests__/LoginView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/views/__tests__/LoginView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginView from '../LoginView';

// Mock all dependencies
vi.mock('../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../store/useStore', () => {
  const store = {
    setUser: vi.fn(),
    setMemberships: vi.fn(),
    setActiveMembershipId: vi.fn(),
    darkMode: false,
    toggleDarkMode: vi.fn(),
  };
  const useStore = vi.fn((selector) => (typeof selector === 'function' ? selector(store) : store));
  (useStore as Record<string, unknown>).__mockStore = store;
  return { default: useStore, useStoreShallow: vi.fn((selector) => selector(store)) };
});

vi.mock('../../hooks/useTheme', () => ({
  useTheme: vi.fn(),
}));

vi.mock('../../utils/trpc', () => ({
  trpc: { useUtils: () => ({}) },
}));

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Clear URL state
    window.history.replaceState({}, '', '/');
  });

  it('renders email step by default', () => {
    render(<LoginView />);
    expect(screen.getByText('TESSERA')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('login_email_placeholder')).toBeInTheDocument();
  });

  it('transitions to password step after lookup returns local', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ authMethods: ['local'], partnerCount: 1 }),
    });

    render(<LoginView />);
    fireEvent.change(screen.getByPlaceholderText('login_email_placeholder'), {
      target: { value: 'user@acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_continue' }));

    await waitFor(() => {
      expect(screen.getByText('user@acme.com')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('login_password_placeholder')).toBeInTheDocument();
    });
  });

  it('shows SSO option when lookup returns local+sso', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ authMethods: ['local', 'sso'], partnerCount: 1 }),
    });

    render(<LoginView />);
    fireEvent.change(screen.getByPlaceholderText('login_email_placeholder'), {
      target: { value: 'user@mixed.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_continue' }));

    await waitFor(() => {
      expect(screen.getByText('login_sso_option')).toBeInTheDocument();
    });
  });

  it('transitions to reset step when forgot is clicked', async () => {
    // First get to password step
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ authMethods: ['local'], partnerCount: 1 }),
    });

    render(<LoginView />);
    fireEvent.change(screen.getByPlaceholderText('login_email_placeholder'), {
      target: { value: 'user@acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_continue' }));

    await waitFor(() => {
      expect(screen.getByText('login_forgot')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('login_forgot'));

    expect(screen.getByText('login_reset_heading')).toBeInTheDocument();
  });

  it('returns to email step when change email is clicked', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ authMethods: ['local'], partnerCount: 1 }),
    });

    render(<LoginView />);
    fireEvent.change(screen.getByPlaceholderText('login_email_placeholder'), {
      target: { value: 'user@acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'login_continue' }));

    await waitFor(() => {
      expect(screen.getByText('login_change_email')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('login_change_email'));

    expect(screen.getByPlaceholderText('login_email_placeholder')).toBeInTheDocument();
  });

  it('renders TESSERA logo and status footer', () => {
    render(<LoginView />);
    expect(screen.getByText('TESSERA')).toBeInTheDocument();
    expect(screen.getByText('login_systems_operational')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec client npx vitest run src/views/__tests__/LoginView.test.tsx --reporter verbose
```

Expected: FAIL — tests don't match current LoginView structure.

- [ ] **Step 3: Rewrite LoginView**

Replace the entire contents of `client/src/views/LoginView.tsx`. The new version:
- Uses a state machine (`step` state: `'email' | 'password' | 'sso-redirect' | 'reset' | 'partner-picker' | 'demo' | 'mfa'`)
- Delegates to step components from `components/login/`
- Preserves demo login as a separate mode (toggled via StatusFooter "Demo" link)
- Preserves MFA challenge flow (triggered by server `mfaRequired` response)
- Preserves SSO callback handling from URL hash
- Preserves password reset token handling from URL query

```tsx
import { useState, useEffect, useRef } from 'react';
import { useStoreShallow } from '../store/useStore';
import { useT } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import type { User, Membership, LookupResponse } from '../types';
import {
  EmailStep,
  PasswordStep,
  ResetStep,
  PartnerPicker,
  StatusFooter,
  ErrorBanner,
} from '../components/login';
import DarkModeToggle from '../components/DarkModeToggle';
import LegalModal from '../components/LegalModal';
import SystemBackground from '../components/SystemBackground';
import { ShieldCheck } from 'lucide-react';

/** Steps in the login state machine */
type LoginStep = 'email' | 'password' | 'sso-redirect' | 'reset' | 'partner-picker' | 'mfa' | 'demo';

/** Version displayed in footer — update on release */
const APP_VERSION = '2.0.0';

export default function LoginView() {
  const { setUser, setMemberships, setActiveMembershipId } = useStoreShallow((s) => ({
    setUser: s.setUser,
    setMemberships: s.setMemberships,
    setActiveMembershipId: s.setActiveMembershipId,
  }));
  const t = useT();
  useTheme();

  // State machine
  const [step, setStep] = useState<LoginStep>('email');
  const [email, setEmail] = useState('');
  const [authMethods, setAuthMethods] = useState<('local' | 'sso')[]>([]);
  const [bannerError, setBannerError] = useState('');
  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(null);

  // Partner picker state
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [pendingMemberships, setPendingMemberships] = useState<Membership[]>([]);

  // MFA state (preserved from original)
  const [totpCode, setTotpCode] = useState('');
  const mfaPasswordRef = useRef<string>('');
  const [mfaPending, setMfaPending] = useState<{
    endpoint: string;
    body: Record<string, unknown>;
  } | null>(null);
  const [isMfaLoading, setIsMfaLoading] = useState(false);

  // Handle URL params on mount (reset token, SSO callback, SSO error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Password reset token from email link
    const token = params.get('token');
    if (token) {
      setStep('reset');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // SSO error
    const ssoError = params.get('sso_error');
    if (ssoError) {
      if (ssoError === 'no_matching_groups') {
        setBannerError(t('sso_no_groups_message'));
      } else {
        setBannerError(decodeURIComponent(ssoError));
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // SSO callback — verify session via /api/v1/auth/me
    const hash = window.location.hash;
    if (hash.startsWith('#sso_callback=')) {
      window.history.replaceState({}, document.title, window.location.pathname);
      fetch('/api/v1/auth/me', { credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) throw new Error('SSO session verification failed');
          const data = await res.json();
          const verifiedUser: User = data.user;
          const verifiedMemberships: Membership[] = data.memberships || [];
          if (verifiedMemberships.length > 1 && !verifiedUser.isPlatformOperator) {
            setPendingUser(verifiedUser);
            setPendingMemberships(verifiedMemberships);
            setStep('partner-picker');
          } else {
            completeLogin(verifiedUser, verifiedMemberships);
          }
        })
        .catch(() => {
          setBannerError(t('login_sso_verify_error'));
        });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Final login completion — set store and redirect */
  function completeLogin(user: User, memberships: Membership[]) {
    setUser(user);
    setMemberships(memberships);
    if (memberships.length > 0 && !user.isPlatformOperator) {
      setActiveMembershipId(memberships[0].id);
    }
  }

  /** Handle lookup result from EmailStep */
  function handleLookupResult(lookupEmail: string, result: LookupResponse) {
    setEmail(lookupEmail);
    setAuthMethods(result.authMethods);
    setBannerError('');

    // SSO-only → redirect immediately
    if (result.authMethods.length === 1 && result.authMethods[0] === 'sso') {
      setStep('sso-redirect');
      // Redirect to SSO login (server will determine the IdP)
      window.location.href = `/api/v1/auth/sso/login?email=${encodeURIComponent(lookupEmail)}`;
      return;
    }

    // Local or mixed → show password step
    setStep('password');
  }

  /** Handle login result from PasswordStep */
  function handleLoginResult(result: {
    user: User;
    memberships: Membership[];
    mfaRequired?: boolean;
    mfaEndpoint?: string;
    mfaBody?: Record<string, unknown>;
  }) {
    setBannerError('');

    // MFA required
    if (result.mfaRequired && result.mfaEndpoint && result.mfaBody) {
      mfaPasswordRef.current = String(result.mfaBody.password || '');
      setMfaPending({ endpoint: result.mfaEndpoint, body: result.mfaBody });
      setStep('mfa');
      return;
    }

    const { user, memberships } = result;

    // Multi-partner → show picker
    if (memberships.length > 1 && !user.isPlatformOperator) {
      setPendingUser(user);
      setPendingMemberships(memberships);
      setStep('partner-picker');
      return;
    }

    completeLogin(user, memberships);
  }

  /** Handle partner selection */
  function handlePartnerSelect(membership: Membership) {
    if (pendingUser) {
      setActiveMembershipId(membership.id);
      completeLogin(pendingUser, pendingMemberships);
    }
  }

  /** Handle SSO login from password step */
  function handleSsoLogin() {
    window.location.href = `/api/v1/auth/sso/login?email=${encodeURIComponent(email)}`;
  }

  /** Handle MFA TOTP submission */
  async function handleMfaSubmit() {
    if (!mfaPending || !totpCode.trim()) return;
    setIsMfaLoading(true);
    setBannerError('');

    try {
      const res = await fetch(mfaPending.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...mfaPending.body, totpCode: totpCode.trim() }),
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        setBannerError(data.error || t('login_mfa_invalid'));
        return;
      }

      const user: User = data.user;
      const memberships: Membership[] = data.memberships || [];
      if (memberships.length > 1 && !user.isPlatformOperator) {
        setPendingUser(user);
        setPendingMemberships(memberships);
        setStep('partner-picker');
      } else {
        completeLogin(user, memberships);
      }
    } catch {
      setBannerError(t('login_network_error'));
    } finally {
      setIsMfaLoading(false);
    }
  }

  return (
    <>
      <SystemBackground />
      <div className="relative flex min-h-screen flex-col items-center justify-center px-4">
        {/* Theme toggle — top right */}
        <div className="absolute top-5 right-6">
          <DarkModeToggle />
        </div>

        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="font-mono text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
            TESSERA
          </h1>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[2px] text-[var(--color-text-muted)]">
            {t('login_tagline')}
          </p>
        </div>

        {/* Login card */}
        <div className="w-full max-w-[320px] border-2 border-[var(--color-border)] p-7">
          <ErrorBanner message={bannerError} />

          {step === 'email' && (
            <EmailStep
              onLookupResult={handleLookupResult}
              initialEmail={email}
            />
          )}

          {step === 'password' && (
            <PasswordStep
              email={email}
              showSsoOption={authMethods.includes('sso')}
              onLogin={handleLoginResult}
              onForgot={() => { setBannerError(''); setStep('reset'); }}
              onChangeEmail={() => { setBannerError(''); setStep('email'); }}
              onSsoLogin={handleSsoLogin}
              onBannerError={setBannerError}
            />
          )}

          {step === 'sso-redirect' && (
            <div className="py-8 text-center">
              <p className="font-mono text-sm text-[var(--color-text-muted)]">
                {t('login_sso_redirecting')}
              </p>
            </div>
          )}

          {step === 'reset' && (
            <ResetStep
              email={email}
              onBack={() => { setBannerError(''); setStep(email ? 'password' : 'email'); }}
            />
          )}

          {step === 'partner-picker' && (
            <PartnerPicker
              memberships={pendingMemberships}
              onSelect={handlePartnerSelect}
            />
          )}

          {step === 'mfa' && (
            <div>
              <h3 className="mb-4 font-mono text-sm font-bold uppercase text-[var(--color-text-primary)]">
                {t('login_mfa_heading')}
              </h3>
              <p className="mb-4 font-sans text-sm text-[var(--color-text-secondary)]">
                {t('login_mfa_description')}
              </p>
              <div className="mb-4">
                <label
                  htmlFor="mfa-code"
                  className="mono-label mb-1.5 block text-[9px] uppercase text-[var(--color-text-muted)]"
                >
                  {t('login_mfa_code_label')}
                </label>
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-[var(--color-accent-blue)]" />
                  <input
                    id="mfa-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    className="input-field w-full font-mono tracking-[4px]"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && handleMfaSubmit()}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleMfaSubmit}
                disabled={isMfaLoading || totpCode.length < 6}
                className="btn-primary w-full py-3 text-xs"
              >
                {t('login_mfa_verify')}
              </button>
              <button
                type="button"
                onClick={() => { setStep('password'); setTotpCode(''); setBannerError(''); }}
                className="mt-3 block w-full text-center font-mono text-[10px] text-[var(--color-accent-blue)] hover:underline"
              >
                {t('login_back_to_login')}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <StatusFooter
          version={APP_VERSION}
          onLegalClick={() => setLegalModal('terms')}
          showDemo={import.meta.env.DEV}
          onDemoClick={() => setStep('demo')}
        />
      </div>

      {legalModal && (
        <LegalModal
          type={legalModal}
          onClose={() => setLegalModal(null)}
        />
      )}
    </>
  );
}
```

**Note for implementer:** The `demo` step should render the existing demo user card from the old LoginView. Extract the demo user list and demo login handler from the old code into the `demo` step case. This is optional for v1 — the critical flow is email → password → login.

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec client npx vitest run src/views/__tests__/LoginView.test.tsx --reporter verbose
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Verify in browser**

```bash
docker logs -f tessera-client-1
```

Open browser, verify:
1. Login page loads with email input
2. Enter email → Continue → password step appears
3. "Forgot?" → reset step
4. "Change" link → back to email
5. Theme toggle works (dark/light)
6. Footer shows version and status

- [ ] **Step 6: Commit**

```bash
git add client/src/views/LoginView.tsx client/src/views/__tests__/LoginView.test.tsx
git commit -m "feat: rewrite LoginView with email-first state machine"
```

---

## Task 11: Add i18n keys

**Files:**
- Modify: i18n translation files (check existing i18n structure for file locations)

- [ ] **Step 1: Find and read the i18n files**

```bash
docker compose exec client find src -name '*.json' -path '*/i18n/*' -o -name '*.ts' -path '*/i18n/*' | head -20
```

- [ ] **Step 2: Add translation keys**

Add these keys to each language file (en, nl, fr):

| Key | English | Purpose |
|-----|---------|---------|
| `login_email_label` | `Email` | Email field label |
| `login_email_placeholder` | `you@company.com` | Email placeholder |
| `login_email_required` | `Email is required` | Empty email error |
| `login_email_invalid` | `Enter a valid email address` | Invalid format error |
| `login_continue` | `Continue` | Continue button |
| `login_password_label` | `Password` | Password field label |
| `login_password_placeholder` | `Enter your password` | Password placeholder |
| `login_password_required` | `Password is required` | Empty password error |
| `login_sign_in` | `Sign In` | Sign in button |
| `login_forgot` | `Forgot?` | Forgot password link |
| `login_change_email` | `Change` | Change email link |
| `login_or` | `OR` | Divider text |
| `login_sso_option` | `Sign In with SSO` | SSO button |
| `login_sso_redirecting` | `Redirecting to SSO...` | SSO redirect message |
| `login_sso_verify_error` | `SSO verification failed` | SSO callback error |
| `login_reset_heading` | `Reset your password` | Reset form heading |
| `login_send_reset` | `Send Reset Link` | Reset submit button |
| `login_reset_success` | `Check your email for a reset link` | Reset success |
| `login_reset_error` | `Could not send reset link` | Reset error |
| `login_back_to_login` | `Back to sign in` | Back link |
| `login_select_org` | `Select your organization` | Partner picker heading |
| `login_inactive` | `Inactive` | Inactive partner badge |
| `login_tagline` | `Real-Time Support Platform` | Below logo |
| `login_systems_operational` | `All systems operational` | Status footer |
| `login_legal` | `Legal` | Legal link |
| `login_demo` | `Demo` | Demo mode link |
| `login_invalid_credentials` | `Invalid email or password` | Generic auth error |
| `login_network_error` | `Connection error. Please try again.` | Network error |
| `login_lookup_error` | `Something went wrong. Please try again.` | Lookup failure |
| `login_mfa_heading` | `Two-Factor Authentication` | MFA heading |
| `login_mfa_description` | `Enter the 6-digit code from your authenticator app` | MFA description |
| `login_mfa_code_label` | `Verification Code` | MFA input label |
| `login_mfa_verify` | `Verify` | MFA submit button |
| `login_mfa_invalid` | `Invalid verification code` | MFA error |
| `login_show_password` | `Show password` | Eye icon aria |
| `login_hide_password` | `Hide password` | Eye-off icon aria |

- [ ] **Step 3: Commit**

```bash
git add client/src/i18n/
git commit -m "feat: add i18n keys for email-first login page"
```

---

## Task 12: Run full test suite

- [ ] **Step 1: Run all client tests**

```bash
docker compose exec client npm test
```

Expected: All tests pass, including new login component tests.

- [ ] **Step 2: Run all server tests**

```bash
docker compose exec server npm test
```

Expected: All tests pass, including new auth-lookup test.

- [ ] **Step 3: Run typecheck**

```bash
docker compose exec client npx tsc --noEmit
docker compose exec server npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Fix any failures**

If any tests fail, fix them before proceeding. Common issues:
- Missing i18n keys (check for typos)
- Import paths (ensure `.js` extension on server imports)
- Mock setup (ensure all dependencies are mocked)

- [ ] **Step 5: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve test and type issues from login page rewrite"
```
