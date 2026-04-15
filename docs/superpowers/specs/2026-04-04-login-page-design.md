# Guichet Login Page — Design Spec

**Date:** 2026-04-04
**Status:** Approved
**Scope:** Login/welcome page with email-first auth flow, light/dark theme support

## Overview

A single login page serving as the entry point for all Guichet users. Email-first flow determines auth method (local vs SSO) from the user's email. Supports dark and light themes via CSS custom property toggle. No marketing content — this is an internal app login.

## User Flow

### 1. Email Entry (Initial State)

User lands on the login page and sees:
- GUICHET logo + "Real-Time Support Platform" tagline
- A centered card with a single email field + "Continue" button
- Theme toggle (top-right corner)
- Footer: system status dot, version, "What's new" link, legal

### 2. Server Lookup

On "Continue", the server receives the email and determines:
- Which partner memberships exist for this email
- The auth method for each partner (`local`, `sso`, `both`)

### 3. Routing

| Scenario | Behavior |
|----------|----------|
| No account found | Card transforms → show password field anyway (same as local auth, to avoid leaking account existence). Error surfaces at login: "Invalid email or password" |
| Single partner, local auth | Card transforms → show password field |
| Single partner, SSO auth | Card shows "Redirecting to SSO..." → redirect to IdP |
| Single partner, both | Card transforms → show password field + "Or sign in with SSO" link |
| Multiple partners, all local | Card transforms → show password field (partner picker comes after login) |
| Multiple partners, mixed auth | Card transforms → show password field + "Or sign in with SSO" link. SSO link goes to partner picker first (user selects which partner to SSO into), then redirects to that partner's IdP |
| All partners inactive | Card transforms → show password field anyway. Error surfaces at login: "This organization is currently inactive" |

### 4. Password Entry (Local Auth)

Card transforms (same page, no navigation) to show:
- Email displayed as read-only (with "Change" link to go back)
- Password field
- "Sign In" button
- "Forgot?" link next to password label
- "Or sign in with SSO" link (only if partner supports SSO)

### 5. Password Reset

When "Forgot?" is clicked, card transforms to show:
- "Reset your password" heading
- Email field (pre-filled from step 1)
- "Send Reset Link" button
- "Back to sign in" link to return to password entry

### 6. Post-Login Partner Picker

If the user has multiple partner memberships, after successful authentication:
- New screen replaces the login card
- Shows list of partner organizations (name + role badge)
- Inactive partners shown greyed out with "Inactive" badge (not clickable)
- Selecting a partner issues JWT scoped to that partner

## Visual Design

### Theme System

Two themes driven entirely by CSS custom properties, toggled via a switch in the top-right corner.

**Dark mode (default):**
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#09090b` | Page background |
| `--card-bg` | `#18181b` | Input backgrounds |
| `--border` | `#27272a` | Card border, dividers |
| `--border-strong` | `#3f3f46` | Input borders |
| `--text` | `#fafafa` | Primary text |
| `--text-muted` | `#a1a1aa` | Input placeholder text |
| `--text-dim` | `#71717a` | Labels, secondary text |
| `--text-faint` | `#52525b` | Field labels |
| `--accent` | `#3b82f6` | Links, toggle knob |
| `--btn-bg` | `#3b82f6` | Primary button |
| `--btn-text` | `#fff` | Primary button text |

**Light mode:**
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#fafaf9` | Page background |
| `--card-bg` | `#fff` | Input backgrounds |
| `--border` | `#e7e5e4` | Card border, dividers |
| `--border-strong` | `#e7e5e4` | Input borders (2px) |
| `--text` | `#1c1917` | Primary text |
| `--text-muted` | `#78716c` | Input placeholder text |
| `--text-dim` | `#a8a29e` | Labels, secondary text |
| `--text-faint` | `#a8a29e` | Field labels |
| `--accent` | `#3b82f6` | Links, toggle knob |
| `--btn-bg` | `#1c1917` | Primary button |
| `--btn-text` | `#fafaf9` | Primary button text |

### Typography

- **Logo:** JetBrains Mono, 32px, weight 800, letter-spacing -1.5px
- **Tagline:** JetBrains Mono, 10px, uppercase, letter-spacing 2px
- **Field labels:** JetBrains Mono, 9px, uppercase
- **Buttons:** JetBrains Mono, 12px, uppercase, letter-spacing 0.5px
- **Input text:** Inter, 13px
- **Footer:** JetBrains Mono 9px (status), 10px (links)

### Layout

- Page: full viewport, flexbox centered vertically and horizontally
- Card: 320px width, 2px solid border, 28px padding
- Theme toggle: absolute positioned top-right (20px top, 24px right)
- Footer: below card, 28px margin-top

### Brutalist Rules

- No `border-radius` anywhere (no rounded corners)
- No gradients
- No box shadows
- No decorative animations
- Theme toggle transition: 150ms ease (background + position)
- Card state transforms: instant (no slide/fade between email → password → reset states)

## Error Handling

### Field-Level (Inline)

Displayed directly below the relevant input field in red (`#ef4444` dark, `#dc2626` light).

| Field | Validation | Message |
|-------|-----------|---------|
| Email | Empty | "Email is required" |
| Email | Invalid format | "Enter a valid email address" |
| Password | Empty | "Password is required" |

### Server-Level (Banner)

Displayed as a banner at the top of the card, inside the card border. Background: `#1a0a0a` dark / `#fef2f2` light. Border-left: 2px solid `#ef4444`.

| Error | Message |
|-------|---------|
| No account | "No account found for this email" |
| Invalid credentials | "Invalid email or password" |
| Account locked | "Account locked. Try again in X minutes" |
| Partner inactive | "This organization is currently inactive" |
| SSO failure | "SSO authentication failed. Contact your admin" |
| Rate limited | "Too many attempts. Try again later" |

Note: "Invalid email or password" is intentionally vague (does not reveal whether the email exists) for security.

## Components

### LoginPage (route: `/login`)

Top-level page component. Manages:
- Theme state (dark/light toggle, persisted to localStorage)
- Card state machine: `email` → `password` | `sso-redirect` | `reset` → `partner-picker`
- Error state (field-level + banner)

### EmailStep

- Email input + "Continue" button
- On submit: calls server to lookup auth method

### PasswordStep

- Read-only email display + "Change" link
- Password input + "Forgot?" link
- "Sign In" button
- Optional "Or sign in with SSO" link

### ResetStep

- "Reset your password" heading
- Email input (pre-filled)
- "Send Reset Link" button
- "Back to sign in" link
- Success state: "Check your email for a reset link"

### PartnerPicker

- List of partner memberships (name, role badge, status)
- Inactive partners greyed out
- Click to select → issues scoped JWT

### ThemeToggle

- Toggle switch component (top-right)
- Persists preference to `localStorage`
- Label shows current mode ("Dark" / "Light")

### StatusFooter

- Green dot + "All systems operational" (or red + error text)
- Version number, "What's new" link, "Legal" link

## API Integration

| Action | Endpoint | Method |
|--------|----------|--------|
| Email lookup | New: `POST /api/v1/auth/lookup` | Returns `{ authMethod, partnerCount }` |
| Local login | Existing: `POST /api/v1/auth/login` | Returns JWT cookie |
| SSO initiate | Existing: `GET /api/v1/auth/sso/:partnerId` | Redirects to IdP |
| Password reset | Existing: `POST /api/v1/auth/forgot-password` | Sends reset email |
| Partner switch | Existing: `POST /api/v1/auth/switch-partner` | Re-issues JWT |

### New Endpoint: `POST /api/v1/auth/lookup`

**Purpose:** Given an email, return what auth methods are available without revealing if the account exists.

**Request:** `{ email: string }`

**Response:**
- Account exists: `{ authMethods: ["local"] | ["sso"] | ["local", "sso"], partnerCount: number }`
- Account not found: `{ authMethods: ["local"], partnerCount: 0 }` (returns local as default to not leak account existence — actual error surfaces at login)

**Rate limited:** Same rate limiting as login endpoint.

## Accessibility

- All inputs have associated labels (visually hidden where label text is shown as styled div)
- Tab order: email → continue → theme toggle → footer links
- Error banners use `role="alert"` for screen reader announcement
- Theme toggle is a `button` with `aria-label="Toggle dark mode"`
- Focus visible outlines: 2px solid `var(--accent)`, 2px offset
- `prefers-reduced-motion`: disable the 150ms theme transition
- `prefers-color-scheme`: set initial theme to match OS preference (localStorage overrides)

## Out of Scope

- TOTP/MFA challenge step (future spec)
- Remember me / stay signed in
- Social login providers (Google, GitHub, etc.)
- Registration / sign-up flow
- Branding customization per partner (logo on login)
