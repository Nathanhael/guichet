# Brutalist Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Tessera's entire frontend from strict B&W monochrome to a Raw/Exposed Brutalist aesthetic with Zinc+Blue dark theme, Warm Stone light theme, and JetBrains Mono typography for UI chrome.

**Architecture:** Replace the current B&W color system and Inter-only typography with CSS custom property design tokens. Restyle all 5 views and shared components view-by-view on a feature branch. Zero backend changes.

**Tech Stack:** Tailwind CSS 4 (`@theme` block), CSS custom properties, JetBrains Mono (self-hosted), React 19, Zustand 5.

**Design Spec:** `docs/superpowers/specs/2026-03-26-brutalist-redesign-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `client/src/index.css` | Rewrite | Design tokens, `@font-face`, utility classes, dark variant |
| `client/index.html` | Modify | Add JetBrains Mono font preload, remove Google Fonts |
| `client/public/fonts/` | Create | Self-hosted JetBrains Mono woff2 files |
| `client/src/views/LoginView.tsx` | Restyle | Login form with brutalist treatment |
| `client/src/views/PlatformView.tsx` | Restyle | Platform admin with brutalist tables/tabs |
| `client/src/views/AdminView.tsx` | Restyle | Admin sidebar + panels |
| `client/src/views/SupportView.tsx` | Restyle | Queue + chat + customer info (grid layout) |
| `client/src/views/AgentView.tsx` | Restyle | End-user ticket list + chat |
| `client/src/components/ConfirmDialog.tsx` | Restyle | Modal with brutalist tokens |
| `client/src/components/Toast.tsx` | Restyle | Notification with brutalist tokens |
| `client/src/components/platform/*.tsx` | Restyle | All platform feature components |
| `client/src/components/admin/*.tsx` | Restyle | All admin feature components |
| `client/src/components/support/*.tsx` | Restyle | All support feature components |
| `client/src/components/agent/*.tsx` | Restyle | All agent feature components |
| `client/src/App.tsx` | Modify | Update shell/layout classes |
| `CLAUDE.md` | Modify | Update design mandates |

---

## Task 1: Create Feature Branch

- [ ] **Step 1: Create and switch to feature branch**

```bash
cd D:/Projects_Coding/tessera
git checkout -b feature/brutalist-redesign
```

- [ ] **Step 2: Verify branch**

```bash
git branch --show-current
```

Expected: `feature/brutalist-redesign`

---

## Task 2: Download and Self-Host JetBrains Mono

- [ ] **Step 1: Create fonts directory**

```bash
mkdir -p client/public/fonts
```

- [ ] **Step 2: Download JetBrains Mono woff2 files**

Download from the official JetBrains Mono GitHub releases (https://github.com/JetBrains/JetBrainsMono/releases). Extract and copy these 3 files to `client/public/fonts/`:

- `JetBrainsMono-Regular.woff2` (weight 400)
- `JetBrainsMono-Medium.woff2` (weight 500)
- `JetBrainsMono-Bold.woff2` (weight 700)

If downloading is not possible, use the Google Fonts CDN as a temporary fallback in `index.html`:

```html
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Update `client/index.html`**

Replace the existing Google Fonts links with self-hosted font preloads. The current `index.html` has:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

Replace with:

```html
<link rel="preload" href="/fonts/JetBrainsMono-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/JetBrainsMono-Bold.woff2" as="font" type="font/woff2" crossorigin>
```

Note: Inter is loaded via Tailwind CSS 4's default font stack or can be kept via Google Fonts if not bundled. Check if Inter is already available via `@tailwindcss/vite`. If not, keep a separate Google Fonts link for Inter only.

- [ ] **Step 4: Commit**

```bash
git add client/public/fonts/ client/index.html
git commit -m "feat: add self-hosted JetBrains Mono font files"
```

---

## Task 3: Rewrite Design Tokens in `index.css`

This is the foundation — all subsequent tasks depend on these tokens.

- [ ] **Step 1: Read the current `client/src/index.css`**

Understand the current structure:
- Line ~2: `@custom-variant dark`
- Lines ~3-60: `@theme` block with brand/accent/ui colors, shadows, fonts
- Lines ~60-75: `@keyframes` (fade-in, slide-up, slide-in-right)
- Lines ~80-135: `@utility` definitions (surface-card, bubble-*, btn-*, input-field)
- Lines ~140-150: Root CSS variables

- [ ] **Step 2: Rewrite the full `index.css`**

Replace the entire file with:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/* ===== FONT FACES ===== */

@font-face {
  font-family: 'JetBrains Mono';
  src: url('/fonts/JetBrainsMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono';
  src: url('/fonts/JetBrainsMono-Medium.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono';
  src: url('/fonts/JetBrainsMono-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

/* ===== THEME TOKENS ===== */

@theme {
  /* Fonts */
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --font-lexend: 'Lexend', sans-serif;

  /* Light mode colors (default) */
  --color-bg-base: #fafaf9;
  --color-bg-surface: #ffffff;
  --color-bg-elevated: #f5f5f4;
  --color-border: #d6d3d1;
  --color-border-heavy: #1c1917;
  --color-text-primary: #1c1917;
  --color-text-secondary: #57534e;
  --color-text-muted: #a8a29e;
  --color-text-faint: #d6d3d1;
  --color-accent-blue: #2563eb;
  --color-accent-blue-light: #3b82f6;
  --color-accent-purple: #7c3aed;
  --color-accent-red: #ef4444;
  --color-accent-green: #16a34a;
  --color-own-msg-bg: #eff6ff;
  --color-whisper-bg: #faf5ff;

  /* Animation */
  --animate-fade-in: fade-in 150ms ease-out;
}

/* ===== DARK MODE OVERRIDES ===== */

.dark {
  --color-bg-base: #09090b;
  --color-bg-surface: #18181b;
  --color-bg-elevated: #27272a;
  --color-border: #27272a;
  --color-border-heavy: #3f3f46;
  --color-text-primary: #e4e4e7;
  --color-text-secondary: #a1a1aa;
  --color-text-muted: #52525b;
  --color-text-faint: #3f3f46;
  --color-accent-blue: #3b82f6;
  --color-accent-blue-light: #60a5fa;
  --color-accent-purple: #a855f7;
  --color-accent-red: #ef4444;
  --color-accent-green: #22c55e;
  --color-own-msg-bg: #1e3a5f;
  --color-whisper-bg: #1a1520;
}

/* ===== KEYFRAMES ===== */

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ===== REDUCED MOTION ===== */

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0ms !important;
  }
}

/* ===== UTILITY CLASSES ===== */

@utility btn-primary {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 20px;
  background-color: var(--color-accent-blue);
  color: #ffffff;
  border: none;
  cursor: pointer;
}

@utility btn-secondary {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 20px;
  background-color: transparent;
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  cursor: pointer;
}

@utility btn-danger {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 20px;
  background-color: transparent;
  color: var(--color-accent-red);
  border: 1px solid var(--color-accent-red);
  cursor: pointer;
}

@utility input-field {
  width: 100%;
  padding: 10px 12px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-text-primary);
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  outline: none;

  &::placeholder {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  &:focus {
    border-color: var(--color-accent-blue);
  }
}

@utility surface-card {
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border);
}

@utility surface-panel {
  background-color: var(--color-bg-base);
  border: 1px solid var(--color-border);
}

@utility bubble-received {
  background-color: var(--color-bg-elevated);
  border-radius: 1px;
  padding: 10px;
}

@utility bubble-sent {
  background-color: var(--color-own-msg-bg);
  border-left: 2px solid var(--color-accent-blue);
  border-radius: 1px;
  padding: 10px;
}

@utility bubble-whisper {
  background-color: var(--color-whisper-bg);
  border-left: 2px solid var(--color-accent-purple);
  border-radius: 1px;
  padding: 10px;
}

@utility section-header {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

@utility badge {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 6px;
  display: inline-block;
}

@utility mono-label {
  font-family: var(--font-mono);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

@utility mono-id {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-primary);
}

@utility mono-timestamp {
  font-family: var(--font-mono);
  font-size: 8px;
  color: var(--color-text-faint);
}

/* ===== BASE STYLES ===== */

html {
  background-color: var(--color-bg-base);
  color: var(--color-text-primary);
}

body {
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* Dyslexic mode override */
.dyslexic-mode body,
.dyslexic-mode input,
.dyslexic-mode textarea,
.dyslexic-mode button {
  font-family: var(--font-lexend) !important;
}
```

- [ ] **Step 3: Verify the app still loads in Docker**

```bash
docker compose up -d
docker logs -f tessera-client-1
```

Expected: Vite dev server starts without CSS compilation errors. The app will look broken (mismatched classes) — that's expected at this stage.

- [ ] **Step 4: Commit**

```bash
git add client/src/index.css
git commit -m "feat: rewrite design tokens for brutalist theme

Replace B&W color system with Zinc+Blue dark and Warm Stone light tokens.
Add JetBrains Mono @font-face declarations. Rewrite all utility classes
to use CSS custom properties. Add reduced-motion support."
```

---

## Task 4: Update App Shell (`App.tsx`)

- [ ] **Step 1: Read `client/src/App.tsx`** (~147 lines)

Identify all Tailwind classes on the root layout elements. Key patterns to replace:
- `dark:bg-black` → `bg-[var(--color-bg-base)]` (or just rely on `html` base style)
- `dark:border-white` / `border-black` → `border-[var(--color-border)]`
- `font-black uppercase tracking-widest` → appropriate brutalist typography

- [ ] **Step 2: Update the App shell classes**

Replace B&W Tailwind classes with token-based ones throughout `App.tsx`. The main changes:
- Root wrapper: remove `bg-white dark:bg-black` (handled by `html` base style in CSS)
- Any `text-black dark:text-white` → remove (handled by `html` base style)
- `border-black dark:border-white` → `border-[var(--color-border)]`
- `font-black` (weight 900) → `font-bold` (700) for general text, `font-mono font-bold uppercase` for UI labels
- `tracking-widest` → only on monospace UI labels
- Security button: restyle with brutalist tokens

- [ ] **Step 3: Verify app renders**

```bash
docker logs -f tessera-client-1
```

Open browser, verify the app shell renders with new colors. Views will still be broken — that's expected.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: update App shell with brutalist design tokens"
```

---

## Task 5: Restyle Shared Components (ConfirmDialog + Toast)

- [ ] **Step 1: Read and restyle `client/src/components/ConfirmDialog.tsx`** (~39 lines)

Current classes to replace:
- Backdrop: `bg-black` → keep (dark backdrop is correct for both themes)
- Dialog: `bg-white dark:bg-black border-4 border-black dark:border-white` → `bg-[var(--color-bg-surface)] border border-[var(--color-border)]`
- Icon box: `border-4` → `border border-[var(--color-border)]`
- Title: `font-black uppercase tracking-widest` → `font-mono font-bold uppercase tracking-wide`
- Body text: `text-xs` → `text-sm` (Inter, normal case)
- Buttons: Replace inline styles with `btn-primary` / `btn-secondary` utilities

Final ConfirmDialog structure:
```tsx
{/* Backdrop */}
<div className="fixed inset-0 z-[200]">
  <div className="absolute inset-0 bg-black/80" onClick={onCancel} />
  {/* Dialog */}
  <div className="absolute inset-0 flex items-center justify-center p-4">
    <div className="w-full max-w-md bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-8 animate-fade-in">
      {/* Icon */}
      <div className="w-14 h-14 border border-[var(--color-border)] flex items-center justify-center mx-auto mb-6">
        <span className="text-[var(--color-accent-red)] text-xl">!</span>
      </div>
      {/* Title */}
      <h2 className="font-mono font-bold text-sm uppercase tracking-wide text-center text-[var(--color-text-primary)] mb-3">
        {title}
      </h2>
      {/* Message */}
      <p className="text-sm text-[var(--color-text-secondary)] text-center mb-8">
        {message}
      </p>
      {/* Actions */}
      <div className="flex gap-3">
        <button className="btn-secondary flex-1" onClick={onCancel}>{cancelLabel}</button>
        <button className="btn-danger flex-1" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Read and restyle `client/src/components/Toast.tsx`** (~38 lines)

Current classes to replace:
- Container: keep `fixed top-6 right-6 z-[300]`
- Content: `border-2 shadow-[4px_4px_0_0]` → `border border-[var(--color-border)]`
- Animation: `animate-in slide-in-from-top-2` → `animate-fade-in`
- Success toast: `bg-[var(--color-text-primary)] text-[var(--color-bg-base)]` (inverted)
- Error toast: `bg-[var(--color-accent-red)] text-white`
- Text: `font-mono text-[10px] uppercase tracking-wide`

- [ ] **Step 3: Verify both components render**

Open the app, trigger a confirm dialog (e.g., delete action) and a toast notification. Verify they use the new styling.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ConfirmDialog.tsx client/src/components/Toast.tsx
git commit -m "feat: restyle ConfirmDialog and Toast with brutalist tokens"
```

---

## Task 6: Restyle LoginView

- [ ] **Step 1: Read `client/src/views/LoginView.tsx`**

Map all class patterns. Key replacements:
- Container: `bg-white dark:bg-black` → remove (inherited from html)
- Form card: `border-2 border-black dark:border-white` → `border border-[var(--color-border-heavy)]`
- Labels: `text-[10px] font-black uppercase tracking-widest` → `mono-label`
- Inputs: Replace with `input-field` utility
- Buttons: Replace with `btn-primary` / `btn-secondary` utilities
- Error messages: `border-2 border-black` → `border border-[var(--color-accent-red)]`
- Success messages: `border-2 border-black` → `border border-[var(--color-accent-green)]`
- App title: `font-black text-2xl uppercase tracking-widest` → `font-mono font-bold text-sm uppercase tracking-[3px]`
- Demo user cards: Restyle with token borders and mono typography
- Partner selection modal: Same token-based restyling

- [ ] **Step 2: Apply all class replacements**

Work through the file top-to-bottom, replacing every B&W class pattern with its brutalist token equivalent. Key principles:
- All `border-black dark:border-white` → `border-[var(--color-border)]` (or `border-[var(--color-border-heavy)]` for section dividers)
- All `bg-white dark:bg-black` → `bg-[var(--color-bg-surface)]` or remove
- All `text-black dark:text-white` → `text-[var(--color-text-primary)]` or remove
- All `hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black` → `hover:bg-[var(--color-accent-blue)] hover:text-white`
- All `font-black` (weight 900) → `font-bold` (700)
- Label text: use `mono-label` utility
- Ticket IDs, monospace data: use `mono-id` utility

- [ ] **Step 3: Test the login page**

Open http://localhost:5173 (or your Docker-mapped port) in the browser. Verify:
- Login form renders with new typography and borders
- Dark mode toggle works (both themes look correct)
- Demo user section shows properly
- Partner selection modal appears after login
- Error/success messages use accent colors

- [ ] **Step 4: Commit**

```bash
git add client/src/views/LoginView.tsx
git commit -m "feat: restyle LoginView with brutalist design system"
```

---

## Task 7: Restyle PlatformView + Platform Components

- [ ] **Step 1: Read `client/src/views/PlatformView.tsx` and list all platform components**

```bash
ls client/src/components/platform/
```

Expected files: PartnerList.tsx, UserTable.tsx, CreatePartnerModal.tsx, EditPartnerModal.tsx, DeletePartnerModal.tsx, InviteUserModal.tsx, ManageAccessModal.tsx, EditUserProfileModal.tsx, types.ts

- [ ] **Step 2: Restyle `PlatformView.tsx`**

Key changes:
- Tab navigation: Replace B&W tabs with monospace uppercase tabs, active tab gets `border-b-2 border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]`
- Inactive tabs: `text-[var(--color-text-muted)]`
- View title: `font-mono font-bold text-sm uppercase tracking-[3px]`

- [ ] **Step 3: Restyle `PartnerList.tsx`**

Key changes:
- Table: Full borders on all cells (`border border-[var(--color-border)]`)
- Table headers: `section-header` utility (mono, uppercase, muted)
- Partner IDs: `mono-id` utility
- Status badges: `badge` utility + `bg-[var(--color-accent-green)]` (active) or `bg-[var(--color-accent-red)]` (inactive)
- Action buttons: `btn-secondary` or icon buttons with mono styling
- No zebra striping

- [ ] **Step 4: Restyle `UserTable.tsx`**

Same table patterns as PartnerList. Additionally:
- Role column: `mono-id` utility
- Email: `font-mono text-[11px]`
- Search input: `input-field` utility

- [ ] **Step 5: Restyle all modal components**

Apply same pattern to each modal (CreatePartnerModal, EditPartnerModal, DeletePartnerModal, InviteUserModal, ManageAccessModal, EditUserProfileModal):
- Backdrop: `bg-black/80`
- Modal container: `bg-[var(--color-bg-surface)] border border-[var(--color-border)]`
- Title: `font-mono font-bold uppercase tracking-wide`
- Labels: `mono-label` utility
- Inputs: `input-field` utility
- Buttons: `btn-primary` / `btn-secondary` / `btn-danger` utilities
- Remove all `border-black dark:border-white` patterns

- [ ] **Step 6: Test PlatformView**

Log in as a platform operator. Verify:
- Partner list table renders with new styling
- User table renders correctly
- All modals (create, edit, delete partner, invite user, etc.) use brutalist tokens
- Dark mode toggle works across all platform components

- [ ] **Step 7: Commit**

```bash
git add client/src/views/PlatformView.tsx client/src/components/platform/
git commit -m "feat: restyle PlatformView and all platform components with brutalist tokens"
```

---

## Task 8: Restyle AdminView + Admin Components

- [ ] **Step 1: Read `client/src/views/AdminView.tsx` and list admin components**

```bash
ls client/src/components/admin/
```

- [ ] **Step 2: Restyle `AdminView.tsx`**

Key changes:
- Sidebar: `bg-[var(--color-bg-surface)] border-r border-[var(--color-border)]`
- Sidebar nav items: `font-mono text-[10px] uppercase tracking-wide`
- Active nav item: `text-[var(--color-accent-blue)] border-l-2 border-[var(--color-accent-blue)]`
- Inactive nav items: `text-[var(--color-text-muted)]`
- Content panels: `bg-[var(--color-bg-base)]`
- Section headers: `section-header` utility

- [ ] **Step 3: Restyle all admin components**

Apply brutalist tokens to each admin component (team management, departments, business hours, labels, canned responses, stats panels). Same patterns:
- Cards: `surface-card` utility
- Tables: Full cell borders, mono headers
- Forms: `input-field` + `mono-label` + `btn-primary`/`btn-secondary`
- Modals: Same pattern as platform modals

- [ ] **Step 4: Test AdminView**

Log in as an admin. Verify:
- Sidebar navigation renders with monospace labels
- All admin tabs (team, departments, hours, labels, canned responses) render correctly
- Forms, tables, and modals use brutalist tokens
- Dark mode works

- [ ] **Step 5: Commit**

```bash
git add client/src/views/AdminView.tsx client/src/components/admin/
git commit -m "feat: restyle AdminView and all admin components with brutalist tokens"
```

---

## Task 9: Restyle SupportView + Support Components

This is the most complex view — the primary workspace for agents.

- [ ] **Step 1: Read `client/src/views/SupportView.tsx` and list support components**

```bash
ls client/src/components/support/
```

- [ ] **Step 2: Restyle `SupportView.tsx` with CSS Grid layout**

Replace the current flexbox layout with a 3-column CSS Grid:

```tsx
{/* Main grid layout */}
<div className="grid grid-cols-[240px_1fr_220px] h-[calc(100vh-44px)]">
  {/* Queue sidebar */}
  <div className="border-r border-[var(--color-border)] overflow-y-auto">
    {/* Queue content */}
  </div>

  {/* Chat area */}
  <div className="flex flex-col">
    {/* Chat header + messages + input */}
  </div>

  {/* Customer info panel */}
  <div className="border-l border-[var(--color-border)] overflow-y-auto">
    {/* Customer details */}
  </div>
</div>
```

- [ ] **Step 3: Restyle the ticket queue sidebar**

- Queue header: `section-header` utility with ticket count in `text-[var(--color-accent-blue)]`
- Ticket cards: `surface-card` with 1px border, active card gets `border-l-[3px] border-l-[var(--color-accent-blue)]`
- Ticket ID: `mono-id`
- Subject: `text-[11px] text-[var(--color-text-secondary)]`
- Meta (agent, time): `mono-timestamp`
- Status badges: `badge` utility with appropriate color fills

- [ ] **Step 4: Restyle the chat area**

- Chat header: `section-header` with ticket ID and subject
- Action buttons (Transfer, Whisper, Close): `font-mono text-[8px] uppercase border border-[var(--color-border)] px-2 py-1`
- Messages: Use `bubble-received`, `bubble-sent`, `bubble-whisper` utilities
- Sender label: `font-mono text-[8px] text-[var(--color-accent-blue)]`
- Message body: `text-[13px] text-[var(--color-text-primary)]` (Inter, normal case)
- Timestamps: `mono-timestamp`
- Input area: `input-field` utility with `btn-primary` send button (text-only: "SEND")

- [ ] **Step 5: Restyle the customer info panel**

- Panel header: `section-header` ("CUSTOMER")
- Field labels: `mono-label`
- Field values: `text-[12px] text-[var(--color-text-primary)]`
- Email/IDs: `font-mono text-[11px]`
- Online indicator: `w-1.5 h-1.5 bg-[var(--color-accent-green)] inline-block`
- Tags/labels: `font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5`

- [ ] **Step 6: Restyle remaining support components**

Apply the same token-based styling to QueueSidebar, ChatTabBar, CustomerInfoPanel, and any other support sub-components.

- [ ] **Step 7: Test SupportView**

Log in as a support agent. Verify:
- 3-column grid layout renders correctly
- Ticket queue shows with brutalist styling
- Chat area displays messages with correct bubble styles
- Customer info panel shows with monospace labels
- Whisper messages display with purple accent
- Dark mode toggle works
- Responsive behavior (if sidebar collapses)

- [ ] **Step 8: Commit**

```bash
git add client/src/views/SupportView.tsx client/src/components/support/
git commit -m "feat: restyle SupportView with CSS Grid layout and brutalist tokens"
```

---

## Task 10: Restyle AgentView + Agent Components

- [ ] **Step 1: Read `client/src/views/AgentView.tsx` and list agent components**

```bash
ls client/src/components/agent/
```

- [ ] **Step 2: Restyle `AgentView.tsx`**

Key changes:
- Ticket sidebar: Same patterns as SupportView queue
- Chat area: Same bubble/input styling as SupportView
- Focus mode: Full-width chat when active, customer info inline
- Ticket creation form: `input-field` + `mono-label` + `btn-primary`

- [ ] **Step 3: Restyle agent components** (AgentNav, AgentTicketSidebar, TicketForm)

Apply same token patterns used in previous tasks.

- [ ] **Step 4: Test AgentView**

Log in as an agent (end-user). Verify:
- Ticket list renders with brutalist styling
- Chat area works correctly
- New ticket form uses brutalist inputs
- Focus mode works
- Dark mode toggle works

- [ ] **Step 5: Commit**

```bash
git add client/src/views/AgentView.tsx client/src/components/agent/
git commit -m "feat: restyle AgentView and agent components with brutalist tokens"
```

---

## Task 11: Update CLAUDE.md

- [ ] **Step 1: Read `CLAUDE.md` and identify sections to update**

Sections to change:
- "Aesthetics" description → replace B&W mandate with brutalist design system
- "Critical Mandates" → update STRICT B&W and ZERO MOTION entries
- Any other references to monochromatic/B&W design

- [ ] **Step 2: Update CLAUDE.md**

Replace the aesthetics line:
```
**Aesthetics**: Strict B&W only. No colors, gradients, shadows, animations, or transitions. Use `dark:` Tailwind prefix for dark mode (light mode is default).
```

With:
```
**Aesthetics**: Raw/Exposed Brutalist design. Zinc+Blue dark theme (#09090b base) and Warm Stone light theme (#fafaf9 base). JetBrains Mono for UI chrome (nav, labels, badges, buttons), Inter for content text (messages, descriptions). Minimal functional motion (150ms fade-in only). No gradients, no shadows, no border-radius. Design tokens defined as CSS custom properties in `index.css`. See `docs/superpowers/specs/2026-03-26-brutalist-redesign-design.md` for full spec.
```

Update Critical Mandates:
- Replace `**STRICT B&W**: Pure black (#000) and white (#FFF) only. No colors, gradients, or shadows.` with `**BRUTALIST TOKENS**: Use CSS custom property design tokens from index.css. No inline colors, no gradients, no shadows, no border-radius.`
- Replace `**ZERO MOTION**: No animations, transitions, or effects. Static UI.` with `**MINIMAL MOTION**: Only fade-in (150ms) for panels/modals. No slides, bounces, or transitions. Respect prefers-reduced-motion.`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md design mandates for brutalist redesign"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Full app walkthrough**

Test every view in both dark and light mode:
1. Login page (email/password form, demo users, partner selection)
2. Platform view (partner list, user table, all modals)
3. Admin view (sidebar nav, all tabs: team, departments, hours, labels, canned responses)
4. Support view (queue, chat with messages/whispers, customer info)
5. Agent view (ticket list, chat, new ticket form)

- [ ] **Step 2: Run client tests**

```bash
docker compose exec client npm test
```

Fix any test failures caused by changed class names in component snapshots or DOM queries.

- [ ] **Step 3: Run TypeScript check**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: No type errors (this is purely a CSS/class change, no type changes).

- [ ] **Step 4: Fix any test/type issues and commit**

```bash
git add -A
git commit -m "fix: update tests for brutalist redesign class changes"
```

- [ ] **Step 5: Verify git log shows clean history**

```bash
git log --oneline feature/brutalist-redesign ^main
```

Expected: Clean series of commits, one per task.
