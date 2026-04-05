# Navbar & Status Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declutter all 4 view navbars with a unified gear+avatar pattern, simplify agent status from 5 values to 2 (online/away) with auto-away, and standardize left-side navbar branding across all views.

**Architecture:** Two new shared components (`SettingsPopover`, `UserMenu`) replace the monolithic `NavToolbar`. Each view passes config props controlling which items appear. Status simplification touches DB schema, server services, socket handlers, Redis presence, and all client status UI.

**Tech Stack:** React 19, TypeScript, Zustand 5, Tailwind CSS 4, Drizzle ORM, PostgreSQL, Redis, Socket.io, Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-toolbar-status-auth-design.md`

**Docker reminder:** All `npm`, `node`, `npx` commands MUST run via `docker compose exec server ...` or `docker compose exec client ...`. Never on the host.

---

## Track 1: Navbar Consistency & Toolbar Declutter

### Task 1: Create SettingsPopover Component

**Files:**
- Create: `client/src/components/SettingsPopover.tsx`
- Create: `client/src/components/__tests__/SettingsPopover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/__tests__/SettingsPopover.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock child components to isolate SettingsPopover
vi.mock('../../i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../LanguageSwitcher', () => ({ default: () => <div data-testid="lang-switcher">LanguageSwitcher</div> }));
vi.mock('../DarkModeToggle', () => ({ default: () => <div data-testid="dark-toggle">DarkModeToggle</div> }));
vi.mock('../AccessibilityMenu', () => ({ default: () => <div data-testid="accessibility">AccessibilityMenu</div> }));
vi.mock('../NotificationToggle', () => ({ default: () => <div data-testid="notif-toggle">NotificationToggle</div> }));
vi.mock('../NeuroToggle', () => ({ default: () => <div data-testid="neuro-toggle">NeuroToggle</div> }));
vi.mock('../support/ViewModeDropdown', () => ({ default: () => <div data-testid="view-mode">ViewModeDropdown</div> }));

import SettingsPopover from '../SettingsPopover';

describe('SettingsPopover', () => {
  it('renders gear button', () => {
    render(<SettingsPopover />);
    expect(screen.getByLabelText('settings')).toBeInTheDocument();
  });

  it('opens popover on click and shows language + dark mode (always present)', () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByLabelText('settings'));
    expect(screen.getByTestId('lang-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('dark-toggle')).toBeInTheDocument();
  });

  it('shows optional items only when enabled', () => {
    render(<SettingsPopover showAccessibility showNotifications showBionicText showViewMode showFocusMode />);
    fireEvent.click(screen.getByLabelText('settings'));
    expect(screen.getByTestId('accessibility')).toBeInTheDocument();
    expect(screen.getByTestId('notif-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('neuro-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode')).toBeInTheDocument();
    expect(screen.getByText('focus_mode')).toBeInTheDocument();
  });

  it('hides optional items by default', () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByLabelText('settings'));
    expect(screen.queryByTestId('accessibility')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notif-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-mode')).not.toBeInTheDocument();
  });

  it('closes on outside click', () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByLabelText('settings'));
    expect(screen.getByTestId('lang-switcher')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('lang-switcher')).not.toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByLabelText('settings'));
    expect(screen.getByTestId('lang-switcher')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('lang-switcher')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec client npx vitest run src/components/__tests__/SettingsPopover.test.tsx`
Expected: FAIL — cannot find module `../SettingsPopover`

- [ ] **Step 3: Write the SettingsPopover component**

```tsx
// client/src/components/SettingsPopover.tsx
import { useState, useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { useT } from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';
import DarkModeToggle from './DarkModeToggle';
import AccessibilityMenu from './AccessibilityMenu';
import NotificationToggle from './NotificationToggle';
import NeuroToggle from './NeuroToggle';
import ViewModeDropdown from './support/ViewModeDropdown';
import useStore from '../store/useStore';

interface SettingsPopoverProps {
  showAccessibility?: boolean;
  showNotifications?: boolean;
  showBionicText?: boolean;
  showViewMode?: boolean;
  showFocusMode?: boolean;
}

export default function SettingsPopover({
  showAccessibility = false,
  showNotifications = false,
  showBionicText = false,
  showViewMode = false,
  showFocusMode = false,
}: SettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const focusMode = useStore((s) => s.focusMode);
  const toggleFocusMode = useStore((s) => s.toggleFocusMode);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('settings')}
        aria-expanded={open}
        className="w-8 h-8 flex items-center justify-center border border-[var(--color-border)] hover:bg-[var(--color-accent-blue)] hover:text-white"
      >
        <Settings className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--color-bg-surface)] border border-[var(--color-border-heavy)] z-50">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
            <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">
              {t('language')}
            </span>
            <LanguageSwitcher />
          </div>

          {showViewMode && (
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">
                {t('view_mode')}
              </span>
              <ViewModeDropdown />
            </div>
          )}

          {showFocusMode && (
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">
                {t('focus_mode')}
              </span>
              <button
                onClick={toggleFocusMode}
                className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 ${
                  focusMode
                    ? 'bg-[var(--color-accent-blue)] text-white'
                    : 'text-[var(--color-text-muted)]'
                }`}
              >
                {focusMode ? 'ON' : 'OFF'}
              </button>
            </div>
          )}

          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
            <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">
              {t('dark_mode')}
            </span>
            <DarkModeToggle />
          </div>

          {showAccessibility && (
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">
                {t('accessibility')}
              </span>
              <AccessibilityMenu />
            </div>
          )}

          {showBionicText && (
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">
                {t('bionic_text')}
              </span>
              <NeuroToggle />
            </div>
          )}

          {showNotifications && (
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)]">
                {t('notifications')}
              </span>
              <NotificationToggle />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec client npx vitest run src/components/__tests__/SettingsPopover.test.tsx`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/SettingsPopover.tsx client/src/components/__tests__/SettingsPopover.test.tsx
git commit -m "feat: add SettingsPopover component for toolbar declutter"
```

---

### Task 2: Create UserMenu Component

**Files:**
- Create: `client/src/components/UserMenu.tsx`
- Create: `client/src/components/__tests__/UserMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/__tests__/UserMenu.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../../store/useStore', () => ({
  default: vi.fn((selector) => {
    const state = {
      user: { id: 'u1', name: 'Amelie Rousseau', email: 'amelie@acme.com' },
      logout: vi.fn(),
    };
    return selector(state);
  }),
}));
vi.mock('../UserSecurityModal', () => ({ default: ({ onClose }: { onClose: () => void }) => <div data-testid="security-modal"><button onClick={onClose}>close</button></div> }));

import UserMenu from '../UserMenu';

describe('UserMenu', () => {
  it('renders avatar with user initials', () => {
    render(<UserMenu />);
    expect(screen.getByText('AR')).toBeInTheDocument();
  });

  it('opens dropdown on click showing name and sign out', () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByLabelText('user_menu'));
    expect(screen.getByText('Amelie Rousseau')).toBeInTheDocument();
    expect(screen.getByText('amelie@acme.com')).toBeInTheDocument();
    expect(screen.getByText('sign_out')).toBeInTheDocument();
  });

  it('shows feedback button when showFeedback is true', () => {
    const onFeedback = vi.fn();
    render(<UserMenu showFeedback onFeedback={onFeedback} />);
    fireEvent.click(screen.getByLabelText('user_menu'));
    expect(screen.getByText('feedback')).toBeInTheDocument();
  });

  it('hides feedback button by default', () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByLabelText('user_menu'));
    expect(screen.queryByText('feedback')).not.toBeInTheDocument();
  });

  it('shows security button when showSecurity is true', () => {
    render(<UserMenu showSecurity />);
    fireEvent.click(screen.getByLabelText('user_menu'));
    expect(screen.getByText('account_security')).toBeInTheDocument();
  });

  it('closes on outside click', () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByLabelText('user_menu'));
    expect(screen.getByText('sign_out')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('sign_out')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec client npx vitest run src/components/__tests__/UserMenu.test.tsx`
Expected: FAIL — cannot find module `../UserMenu`

- [ ] **Step 3: Write the UserMenu component**

```tsx
// client/src/components/UserMenu.tsx
import { Suspense, lazy, useState, useRef, useEffect } from 'react';
import { MessageSquare, Shield, LogOut } from 'lucide-react';
import { useT } from '../i18n';
import useStore from '../store/useStore';

const UserSecurityModal = lazy(() => import('./UserSecurityModal'));

interface UserMenuProps {
  showFeedback?: boolean;
  showSecurity?: boolean;
  onFeedback?: () => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function UserMenu({
  showFeedback = false,
  showSecurity = false,
  onFeedback,
}: UserMenuProps) {
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  if (!user) return null;

  const initials = getInitials(user.name);

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={t('user_menu')}
          aria-expanded={open}
          className="w-8 h-8 flex items-center justify-center bg-[var(--color-accent-blue)] text-white text-[10px] font-bold font-mono"
        >
          {initials}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--color-bg-surface)] border border-[var(--color-border-heavy)] z-50">
            {/* User info header */}
            <div className="px-3 py-2.5 border-b border-[var(--color-border)]">
              <div className="text-[11px] font-bold uppercase tracking-tight text-[var(--color-text-primary)]">
                {user.name}
              </div>
              <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5">
                {user.email}
              </div>
            </div>

            {/* Feedback (agent only) */}
            {showFeedback && onFeedback && (
              <button
                onClick={() => { onFeedback(); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {t('feedback')}
              </button>
            )}

            {/* Account Security */}
            {showSecurity && (
              <button
                onClick={() => { setSecurityOpen(true); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]"
              >
                <Shield className="h-3.5 w-3.5" />
                {t('account_security')}
              </button>
            )}

            {/* Sign out */}
            <button
              onClick={logout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--color-accent-red)] hover:bg-[var(--color-bg-elevated)]"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t('sign_out')}
            </button>
          </div>
        )}
      </div>

      {securityOpen && (
        <Suspense fallback={null}>
          <UserSecurityModal onClose={() => setSecurityOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec client npx vitest run src/components/__tests__/UserMenu.test.tsx`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/UserMenu.tsx client/src/components/__tests__/UserMenu.test.tsx
git commit -m "feat: add UserMenu component for toolbar declutter"
```

---

### Task 3: Add Missing Translation Keys

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/nl.ts`
- Modify: `client/src/locales/fr.ts`

- [ ] **Step 1: Add new keys to EN locale**

In `client/src/locales/en.ts`, find the `settings` area (near other UI keys) and add:

```typescript
    settings: 'Settings',
    user_menu: 'User menu',
    account_security: 'Account Security',
    language: 'Language',
    dark_mode: 'Dark Mode',
    accessibility: 'Accessibility',
    bionic_text: 'Bionic Text',
    notifications: 'Notifications',
    focus_mode: 'Focus Mode',
    view_mode: 'View Mode',
    platform: 'Platform',
    admin: 'Admin',
    support: 'Support',
    agent: 'Agent',
```

- [ ] **Step 2: Add same keys to NL locale**

```typescript
    settings: 'Instellingen',
    user_menu: 'Gebruikersmenu',
    account_security: 'Accountbeveiliging',
    language: 'Taal',
    dark_mode: 'Donkere modus',
    accessibility: 'Toegankelijkheid',
    bionic_text: 'Bionische tekst',
    notifications: 'Meldingen',
    focus_mode: 'Focusmodus',
    view_mode: 'Weergavemodus',
    platform: 'Platform',
    admin: 'Admin',
    support: 'Support',
    agent: 'Agent',
```

- [ ] **Step 3: Add same keys to FR locale**

```typescript
    settings: 'Paramètres',
    user_menu: 'Menu utilisateur',
    account_security: 'Sécurité du compte',
    language: 'Langue',
    dark_mode: 'Mode sombre',
    accessibility: 'Accessibilité',
    bionic_text: 'Texte bionique',
    notifications: 'Notifications',
    focus_mode: 'Mode focus',
    view_mode: 'Mode d\'affichage',
    platform: 'Plateforme',
    admin: 'Admin',
    support: 'Support',
    agent: 'Agent',
```

- [ ] **Step 4: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/nl.ts client/src/locales/fr.ts
git commit -m "feat: add translation keys for navbar components"
```

---

### Task 4: Replace SupportNav Toolbar

**Files:**
- Modify: `client/src/components/support/SupportNav.tsx`

- [ ] **Step 1: Read the current file**

Read `client/src/components/support/SupportNav.tsx` to have content in context for editing.

- [ ] **Step 2: Replace the entire SupportNav component**

Replace the full file content with:

```tsx
import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import StatusPicker from '../StatusPicker';
import SettingsPopover from '../SettingsPopover';
import UserMenu from '../UserMenu';
import { OnlineSupport } from '../../types';

interface SupportNavProps {
  partnerName: string;
  logoUrl?: string;
  onToggleSidebar: () => void;
}

export default function SupportNav({ partnerName, onToggleSidebar }: SupportNavProps) {
  const user = useStore((s) => s.user);
  const focusMode = useStore((s) => s.focusMode);
  const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
  const availableCount = onlineSupportUsers.filter((u) => u.status === 'available').length;
  const totalOnline = onlineSupportUsers.length;
  const t = useT();

  if (!user) return null;

  return (
    <nav
      className={`px-8 flex items-center justify-between sticky top-0 z-50 border-b border-[var(--color-border)] ${
        focusMode ? 'py-2 bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : 'py-4 bg-[var(--color-bg-surface)]'
      }`}
    >
      {/* Left side: hamburger + TESSERA + SUPPORT + partner name */}
      <div className="flex items-center gap-4">
        {!focusMode && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 hover:bg-[var(--color-accent-blue)] hover:text-white"
            aria-label={t('queue')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <span className="font-bold text-2xl uppercase tracking-tighter">TESSERA</span>
        {!focusMode && (
          <>
            <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono">
              {t('support')}
            </span>
            <div className="h-6 w-px bg-[var(--color-border)]" />
            <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
          </>
        )}
      </div>

      {/* Right side: status + capacity + Ctrl+K + gear + avatar */}
      <div className="flex items-center gap-4">
        <StatusPicker />

        {totalOnline > 0 && !focusMode && (
          <span className="text-[9px] font-mono font-bold text-[var(--color-text-muted)]">
            {availableCount} / {totalOnline}
          </span>
        )}

        {!focusMode && (
          <kbd className="text-[9px] font-mono px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-text-muted)] select-none cursor-default" title={t('cmd_palette_title') || 'Command Palette'}>
            Ctrl+K
          </kbd>
        )}

        <SettingsPopover
          showAccessibility
          showNotifications
          showBionicText
          showViewMode
          showFocusMode
        />
        <UserMenu showSecurity />
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/support/SupportNav.tsx
git commit -m "refactor: replace SupportNav toolbar with SettingsPopover + UserMenu"
```

---

### Task 5: Replace AgentNav Toolbar

**Files:**
- Modify: `client/src/components/agent/AgentNav.tsx`

- [ ] **Step 1: Read the current file**

Read `client/src/components/agent/AgentNav.tsx` to have content in context for editing.

- [ ] **Step 2: Replace the entire AgentNav component**

```tsx
import useStore from '../../store/useStore';
import { useT } from '../../i18n';
import ConnectionStatus from '../ConnectionStatus';
import SettingsPopover from '../SettingsPopover';
import UserMenu from '../UserMenu';

interface AgentNavProps {
  logoUrl?: string;
  partnerName: string;
  industry: string;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  onShowFeedback: () => void;
}

export default function AgentNav({
  partnerName,
  showSidebar,
  onToggleSidebar,
  onShowFeedback,
}: AgentNavProps) {
  const user = useStore((s) => s.user);
  const t = useT();

  if (!user) return null;

  return (
    <nav className="relative z-50 px-6 py-3 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] text-[var(--color-text-primary)] flex items-center justify-between">
      {/* Left side: hamburger + TESSERA + AGENT + partner name */}
      <div className="flex items-center gap-3">
        {showSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 hover:bg-[var(--color-accent-blue)] hover:text-white"
            aria-label={t('my_tickets')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <span className="font-bold text-2xl uppercase tracking-tighter">TESSERA</span>
        <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono">
          {t('agent')}
        </span>
        <div className="h-6 w-px bg-[var(--color-border)]" />
        <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
      </div>

      {/* Right side: connection status + gear + avatar */}
      <div className="flex items-center gap-4">
        <ConnectionStatus />
        <SettingsPopover showAccessibility showNotifications showBionicText />
        <UserMenu showFeedback showSecurity onFeedback={onShowFeedback} />
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/agent/AgentNav.tsx
git commit -m "refactor: replace AgentNav toolbar with SettingsPopover + UserMenu"
```

---

### Task 6: Replace AdminView Inline Toolbar

**Files:**
- Modify: `client/src/views/AdminView.tsx`

- [ ] **Step 1: Read the current file (lines 1-115)**

Read `client/src/views/AdminView.tsx` lines 1–115 (the imports and nav section).

- [ ] **Step 2: Replace imports — remove NavToolbar children, add new components**

Remove these imports:
```tsx
import LanguageSwitcher from '../components/LanguageSwitcher';
import NeuroToggle from '../components/NeuroToggle';
import DarkModeToggle from '../components/DarkModeToggle';
```

Add these imports:
```tsx
import SettingsPopover from '../components/SettingsPopover';
import UserMenu from '../components/UserMenu';
```

- [ ] **Step 3: Replace the right side of the nav (lines ~95-111)**

Replace the entire `<div className="flex items-center gap-4 shrink-0">` block with:

```tsx
        <div className="flex items-center gap-4 shrink-0">
          <PartnerSwitcher />
          <SettingsPopover showBionicText />
          <UserMenu />
        </div>
```

- [ ] **Step 4: Update left side — add ADMIN badge + standardize**

In the left side of the nav, ensure the structure is: hamburger + TESSERA + ADMIN badge + divider + partner name. The current AdminView already has most of this but with slightly different styling. Update to match:

```tsx
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 hover:bg-[var(--color-accent-blue)] hover:text-white"
            aria-label={t('toggle_sidebar')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-bold text-2xl tracking-tighter uppercase">TESSERA</span>
          <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono">
            {t('admin')}
          </span>
          <div className="h-6 w-px bg-[var(--color-border)]" />
          <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
        </div>
```

Remove the logo/initial rendering and the user name/role display — those are now in the avatar dropdown.

- [ ] **Step 5: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add client/src/views/AdminView.tsx
git commit -m "refactor: replace AdminView inline toolbar with SettingsPopover + UserMenu"
```

---

### Task 7: Replace PlatformView Inline Toolbar

**Files:**
- Modify: `client/src/views/PlatformView.tsx`

- [ ] **Step 1: Read the current file (lines 1-65)**

Read `client/src/views/PlatformView.tsx` lines 1–65 (imports and nav section).

- [ ] **Step 2: Replace imports**

Remove:
```tsx
import LanguageSwitcher from '../components/LanguageSwitcher';
import DarkModeToggle from '../components/DarkModeToggle';
```

Add:
```tsx
import SettingsPopover from '../components/SettingsPopover';
import UserMenu from '../components/UserMenu';
```

- [ ] **Step 3: Replace the nav right side**

Replace the `<div className="flex items-center gap-6">` block with:

```tsx
        <div className="flex items-center gap-4">
          <SettingsPopover />
          <UserMenu />
        </div>
```

- [ ] **Step 4: Standardize left side — keep TESSERA + PLATFORM badge**

The left side should be:

```tsx
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold uppercase tracking-tighter font-mono">TESSERA</span>
          <span className="text-[10px] font-bold px-2.5 py-1 bg-[var(--color-text-primary)] text-[var(--color-bg-base)] uppercase tracking-wide font-mono">
            {t('platform')}
          </span>
        </div>
```

- [ ] **Step 5: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add client/src/views/PlatformView.tsx
git commit -m "refactor: replace PlatformView inline toolbar with SettingsPopover + UserMenu"
```

---

### Task 8: Fix BusinessHoursGuard Navbar

**Files:**
- Modify: `client/src/components/BusinessHoursGuard.tsx`

- [ ] **Step 1: Read the current file**

Read `client/src/components/BusinessHoursGuard.tsx` to have content in context.

- [ ] **Step 2: Replace hardcoded navbar and colors**

In the `mode === 'block'` branch (the full-page closed view), replace the hardcoded navbar (lines ~25-36) with the unified pattern using CSS custom property tokens:

Replace:
```tsx
        <div className="border-b-2 border-black dark:border-white px-8 py-4 flex items-center justify-between">
          <div className="font-black text-2xl uppercase tracking-tight">Tessera</div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="text-[10px] font-black uppercase tracking-[0.2em] border-2 border-black dark:border-white px-3 py-1">
                {user.name}
              </div>
            )}
            <div className="text-[10px] font-black uppercase tracking-[0.2em] border-2 border-black dark:border-white px-3 py-1">
              {t('support_chat_closed')}
            </div>
          </div>
        </div>
```

With:
```tsx
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-2xl uppercase tracking-tighter">TESSERA</span>
            <span className="text-[10px] bg-[var(--color-text-primary)] text-[var(--color-bg-base)] px-2.5 py-1 font-bold uppercase tracking-wide font-mono">
              {t('agent')}
            </span>
            <div className="h-6 w-px bg-[var(--color-border)]" />
            <span className="text-sm font-bold uppercase tracking-wide font-mono">{partnerName}</span>
          </div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            {t('support_chat_closed')}
          </div>
        </div>
```

Also replace all hardcoded colors in the body section:
- `bg-white text-black dark:bg-black dark:text-white` → `bg-[var(--color-bg-base)] text-[var(--color-text-primary)]`
- `border-black dark:border-white` → `border-[var(--color-border)]` (or `border-[var(--color-border-heavy)]` for emphasis)
- `font-black` → `font-bold` (consistency)

- [ ] **Step 3: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/BusinessHoursGuard.tsx
git commit -m "fix: replace BusinessHoursGuard hardcoded colors with design tokens, unify navbar"
```

---

### Task 9: Delete NavToolbar and Clean Up Unused Imports

**Files:**
- Delete: `client/src/components/NavToolbar.tsx`
- Verify: no remaining imports of NavToolbar

- [ ] **Step 1: Search for any remaining NavToolbar imports**

Run: `grep -r "NavToolbar" client/src/`

Expected: Only the file itself. If any views still import it, fix those first.

- [ ] **Step 2: Delete NavToolbar**

```bash
rm client/src/components/NavToolbar.tsx
```

- [ ] **Step 3: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors (nothing imports NavToolbar anymore)

- [ ] **Step 4: Run all client tests**

Run: `docker compose exec client npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete NavToolbar component, replaced by SettingsPopover + UserMenu"
```

---

## Track 2: Status Simplification (5 → 2)

### Task 10: Update Database Schema

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Read the schema sections for agent status**

Read `server/db/schema.ts` around `dailyAgentStatus` and `agentStatusLog` tables.

- [ ] **Step 2: Update dailyAgentStatus table — replace 5 columns with 2**

In the `dailyAgentStatus` table definition, replace:

```typescript
  availableSeconds: integer('available_seconds').notNull().default(0),
  breakSeconds: integer('break_seconds').notNull().default(0),
  lunchSeconds: integer('lunch_seconds').notNull().default(0),
  meetingSeconds: integer('meeting_seconds').notNull().default(0),
  trainingSeconds: integer('training_seconds').notNull().default(0),
```

With:

```typescript
  onlineSeconds: integer('online_seconds').notNull().default(0),
  awaySeconds: integer('away_seconds').notNull().default(0),
```

- [ ] **Step 3: Generate Drizzle migration**

Run: `docker compose exec server npx drizzle-kit generate`

Review the generated migration SQL — it should:
1. Drop `available_seconds`, `break_seconds`, `lunch_seconds`, `meeting_seconds`, `training_seconds` columns
2. Add `online_seconds`, `away_seconds` columns

**Important:** Before applying this migration in a real environment, run `npm run db:backup` first.

- [ ] **Step 4: Apply migration**

Run: `docker compose exec server npx drizzle-kit push`

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts server/drizzle/
git commit -m "feat: simplify dailyAgentStatus from 5 status columns to 2 (online/away)"
```

---

### Task 11: Update StatusTracking Service

**Files:**
- Modify: `server/services/statusTracking.ts`

- [ ] **Step 1: Read the current file**

Read `server/services/statusTracking.ts` to have content in context.

- [ ] **Step 2: Update rollupDay function**

Replace the status accumulation map initialization:

```typescript
        userTotals.set(row.userId, { available: 0, break: 0, lunch: 0, meeting: 0, training: 0 });
```

With:

```typescript
        userTotals.set(row.userId, { online: 0, away: 0 });
```

Replace the upsert values:

```typescript
          availableSeconds: totals.available,
          breakSeconds: totals.break,
          lunchSeconds: totals.lunch,
          meetingSeconds: totals.meeting,
          trainingSeconds: totals.training,
```

With:

```typescript
          onlineSeconds: totals.online,
          awaySeconds: totals.away,
```

Replace the onConflictDoUpdate set:

```typescript
          set: {
            availableSeconds: sql`EXCLUDED.available_seconds`,
            breakSeconds: sql`EXCLUDED.break_seconds`,
            lunchSeconds: sql`EXCLUDED.lunch_seconds`,
            meetingSeconds: sql`EXCLUDED.meeting_seconds`,
            trainingSeconds: sql`EXCLUDED.training_seconds`,
          },
```

With:

```typescript
          set: {
            onlineSeconds: sql`EXCLUDED.online_seconds`,
            awaySeconds: sql`EXCLUDED.away_seconds`,
          },
```

- [ ] **Step 3: Verify build compiles**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add server/services/statusTracking.ts
git commit -m "refactor: update statusTracking rollup for online/away (2 statuses)"
```

---

### Task 12: Update Socket Handlers and Presence Service

**Files:**
- Modify: `server/socket/handlers.ts`
- Modify: `server/services/presence.ts`

- [ ] **Step 1: Read socket handlers status:set section**

Read the `status:set` handler in `server/socket/handlers.ts`.

- [ ] **Step 2: Update VALID_STATUSES**

Replace:

```typescript
      const VALID_STATUSES = ['available', 'break', 'lunch', 'meeting', 'training'] as const;
```

With:

```typescript
      const VALID_STATUSES = ['online', 'away'] as const;
```

- [ ] **Step 3: Read presence service**

Read `server/services/presence.ts` to find the Lua script and default status values.

- [ ] **Step 4: Update presence service defaults**

In the `identifyUser` Lua script, change the default status from `'available'` to `'online'`:

```lua
        redis.call('HSET', key,
          ...
          'status', 'online',
```

Also in `broadcastOnlineSupport`, change the fallback:

```typescript
        status: data.status || 'online',
```

- [ ] **Step 5: Verify build compiles**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add server/socket/handlers.ts server/services/presence.ts
git commit -m "refactor: update socket handlers and presence service for online/away statuses"
```

---

### Task 13: Update StatusPicker Component

**Files:**
- Modify: `client/src/components/StatusPicker.tsx`

- [ ] **Step 1: Read the current file**

Read `client/src/components/StatusPicker.tsx` to have content in context.

- [ ] **Step 2: Replace STATUSES array**

Replace:

```typescript
const STATUSES: StatusOption[] = [
  { key: 'available', label: 'status_available', dot: 'bg-accent-green' },
  { key: 'break', label: 'status_break', dot: 'bg-accent-amber' },
  { key: 'lunch', label: 'status_lunch', dot: 'bg-accent-orange' },
  { key: 'meeting', label: 'status_meeting', dot: 'bg-accent-red' },
  { key: 'training', label: 'status_training', dot: 'bg-accent-blue' },
];
```

With:

```typescript
const STATUSES: StatusOption[] = [
  { key: 'online', label: 'status_online', dot: 'bg-accent-green' },
  { key: 'away', label: 'status_away', dot: 'bg-accent-amber' },
];
```

- [ ] **Step 3: Update default state**

Replace:

```typescript
  const [value, setValue] = useState('available');
```

With:

```typescript
  const [value, setValue] = useState('online');
```

- [ ] **Step 4: Update component JSDoc**

Replace:

```typescript
/**
 * Support staff status picker (available / break / lunch / meeting / training).
```

With:

```typescript
/**
 * Support staff status picker (online / away).
```

- [ ] **Step 5: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/StatusPicker.tsx
git commit -m "refactor: simplify StatusPicker to online/away"
```

---

### Task 14: Update statusColors Utility and useIdleStatus Hook

**Files:**
- Modify: `client/src/utils/statusColors.ts`
- Modify: `client/src/hooks/useIdleStatus.ts`

- [ ] **Step 1: Read both files**

Read `client/src/utils/statusColors.ts` and `client/src/hooks/useIdleStatus.ts`.

- [ ] **Step 2: Replace statusColors.ts entirely**

```typescript
const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  online: { dot: 'bg-accent-green', text: 'text-accent-green' },
  away: { dot: 'bg-accent-amber', text: 'text-accent-amber' },
};

const OFFLINE_COLORS = { dot: 'bg-text-muted', text: 'text-text-muted' };

export function getStatusColors(status: string | undefined): { dot: string; text: string } {
  if (!status) return OFFLINE_COLORS;
  return STATUS_COLORS[status] || OFFLINE_COLORS;
}

export function getStatusI18nKey(status: string): string {
  const map: Record<string, string> = {
    online: 'status_online',
    away: 'status_away',
  };
  return map[status] || 'status_offline';
}
```

- [ ] **Step 3: Update useIdleStatus hook**

Replace the idle timeout behavior — currently sets status to `'break'`, should set to `'away'`. And restore to `'online'`:

In the `resetTimer` function, replace:

```typescript
        getSocket().emit('status:set', { status: previousStatusRef.current });
```

With:

```typescript
        getSocket().emit('status:set', { status: 'online' });
```

Replace:

```typescript
        getSocket().emit('status:set', { status: 'break' });
```

With:

```typescript
        getSocket().emit('status:set', { status: 'away' });
```

Update the JSDoc:

```typescript
/**
 * Auto-sets status to 'away' after 5 minutes of inactivity.
 * Restores to 'online' when user returns.
 * Only active for support and admin roles.
 */
```

- [ ] **Step 4: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/statusColors.ts client/src/hooks/useIdleStatus.ts
git commit -m "refactor: update statusColors and useIdleStatus for online/away"
```

---

### Task 15: Update AgentStatusStats Chart

**Files:**
- Modify: `client/src/components/admin/AgentStatusStats.tsx`

- [ ] **Step 1: Read the current file**

Read `client/src/components/admin/AgentStatusStats.tsx` to have content in context.

- [ ] **Step 2: Update the DailyStatusRow interface**

Replace:

```typescript
interface DailyStatusRow {
  date: string;
  userId: string;
  availableSeconds: number;
  breakSeconds: number;
  lunchSeconds: number;
  meetingSeconds: number;
  trainingSeconds: number;
}
```

With:

```typescript
interface DailyStatusRow {
  date: string;
  userId: string;
  onlineSeconds: number;
  awaySeconds: number;
}
```

- [ ] **Step 3: Update the chartData mapping**

Replace:

```typescript
  const chartData = ((teamStats || []) as DailyStatusRow[]).map((row) => ({
    name: row.userId.slice(0, 8),
    date: row.date,
    Available: row.availableSeconds,
    Break: row.breakSeconds,
    Lunch: row.lunchSeconds,
    Meeting: row.meetingSeconds,
    Training: row.trainingSeconds,
  }));
```

With:

```typescript
  const chartData = ((teamStats || []) as DailyStatusRow[]).map((row) => ({
    name: row.userId.slice(0, 8),
    date: row.date,
    Online: row.onlineSeconds,
    Away: row.awaySeconds,
  }));
```

- [ ] **Step 4: Update the BarChart Bar elements**

Replace the 5 `<Bar>` elements with 2:

```tsx
            <Bar dataKey="Online" fill="var(--color-accent-green)" />
            <Bar dataKey="Away" fill="var(--color-accent-amber)" />
```

- [ ] **Step 5: Update the LineChart (Availability Trend)**

Replace the `dataKey` from `"Available"` to `"Online"` and update the stroke color.

- [ ] **Step 6: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add client/src/components/admin/AgentStatusStats.tsx
git commit -m "refactor: simplify AgentStatusStats chart to online/away"
```

---

### Task 16: Update QueueSidebar and AdminTeam Status Display

**Files:**
- Modify: `client/src/components/support/QueueSidebar.tsx`
- Modify: `client/src/components/admin/AdminTeam.tsx`

- [ ] **Step 1: Read QueueSidebar status section**

Read `client/src/components/support/QueueSidebar.tsx` — the `availableCount` filter on line 43 and the team display section.

- [ ] **Step 2: Update QueueSidebar**

Replace:

```typescript
  const availableCount = onlineSupportUsers.filter((u) => u.status === 'available').length;
```

With:

```typescript
  const availableCount = onlineSupportUsers.filter((u) => u.status === 'online').length;
```

The `getStatusColors` and `getStatusI18nKey` calls will automatically use the updated utility from Task 14.

- [ ] **Step 3: Read AdminTeam status section and verify no hardcoded status strings**

Read `client/src/components/admin/AdminTeam.tsx` — it uses `getStatusColors` and `getStatusI18nKey` which are already updated. No changes needed unless there are hardcoded `'available'` strings.

- [ ] **Step 4: Update SupportNav available count** 

In `client/src/components/support/SupportNav.tsx` (already updated in Task 4), verify the `availableCount` filter uses `'online'`:

```typescript
  const availableCount = onlineSupportUsers.filter((u) => u.status === 'online').length;
```

Update this in the Task 4 output if not already done.

- [ ] **Step 5: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/support/QueueSidebar.tsx client/src/components/admin/AdminTeam.tsx client/src/components/support/SupportNav.tsx
git commit -m "refactor: update QueueSidebar and AdminTeam for online/away status"
```

---

### Task 17: Update Translation Keys for Status

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/nl.ts`
- Modify: `client/src/locales/fr.ts`

- [ ] **Step 1: Update EN locale**

Remove:
```typescript
    status_available: 'Available',
    status_break: 'Break',
    status_lunch: 'Lunch',
    status_meeting: 'Meeting',
    status_training: 'Training / Focus',
```

Add:
```typescript
    status_online: 'Online',
    status_away: 'Away',
```

Remove command palette status commands:
```typescript
    cmd_status_available: 'Set status: Available',
    cmd_status_break: 'Set status: Break',
    cmd_status_lunch: 'Set status: Lunch',
    cmd_status_meeting: 'Set status: Meeting',
    cmd_status_training: 'Set status: Training',
```

Add:
```typescript
    cmd_status_online: 'Set status: Online',
    cmd_status_away: 'Set status: Away',
```

Update idle message:
```typescript
    idle_status_set: 'Status set to Away (idle)',
```

- [ ] **Step 2: Update NL locale**

Remove the same 5 status keys. Add:
```typescript
    status_online: 'Online',
    status_away: 'Afwezig',
    cmd_status_online: 'Status: Online',
    cmd_status_away: 'Status: Afwezig',
    idle_status_set: 'Status op Afwezig gezet (inactief)',
```

- [ ] **Step 3: Update FR locale**

Remove the same 5 status keys. Add:
```typescript
    status_online: 'En ligne',
    status_away: 'Absent',
    cmd_status_online: 'Statut : En ligne',
    cmd_status_away: 'Statut : Absent',
    idle_status_set: 'Statut mis sur Absent (inactif)',
```

- [ ] **Step 4: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/nl.ts client/src/locales/fr.ts
git commit -m "feat: update translation keys for simplified online/away status"
```

---

### Task 18: Update Seed Script

**Files:**
- Modify: `server/seed.ts`

- [ ] **Step 1: Read the seed script status section (around lines 1190-1225)**

Read `server/seed.ts` lines 1185–1230.

- [ ] **Step 2: Simplify daily_agent_status seed data**

Replace the 5-column generation:

```typescript
      const breakSec = randInt(1800, 3600);
      const lunchSec = randInt(1800, 3600);
      const meetingSec = randInt(900, 3600);
      const trainingSec = randInt(900, 1800);
```

With:

```typescript
      const awaySec = randInt(3600, 10800);  // 1-3 hours away per day
```

Replace the insert values:

```typescript
        availableSeconds: availSec,
        breakSeconds: breakSec,
        lunchSeconds: lunchSec,
        meetingSeconds: meetingSec,
        trainingSeconds: trainingSec,
```

With:

```typescript
        onlineSeconds: availSec,
        awaySeconds: awaySec,
```

- [ ] **Step 3: Update agent_status_log seed data**

Replace the log entries that use `'available'`, `'break'`, `'lunch'`, `'meeting'`, `'training'` with alternating `'online'` and `'away'`:

```typescript
        { status: 'online', durationSec: Math.floor(availSec * 0.4) },
        { status: 'away', durationSec: awaySec },
        { status: 'online', durationSec: Math.floor(availSec * 0.6) },
```

- [ ] **Step 4: Commit**

```bash
git add server/seed.ts
git commit -m "refactor: update seed script for online/away status model"
```

---

### Task 19: Update Command Palette (if applicable)

**Files:**
- Modify: `client/src/components/support/CommandPalette.tsx`

- [ ] **Step 1: Read CommandPalette and search for status commands**

Read `client/src/components/support/CommandPalette.tsx` and search for any `status` command entries.

- [ ] **Step 2: Replace status commands**

If the command palette has status-related commands (e.g., "Set status: Available"), replace the 5 commands with 2:

```typescript
{ id: 'status-online', label: t('cmd_status_online'), action: () => { getSocket().emit('status:set', { status: 'online' }); } },
{ id: 'status-away', label: t('cmd_status_away'), action: () => { getSocket().emit('status:set', { status: 'away' }); } },
```

Remove the old `status-available`, `status-break`, `status-lunch`, `status-meeting`, `status-training` commands.

- [ ] **Step 3: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/support/CommandPalette.tsx
git commit -m "refactor: update CommandPalette status commands for online/away"
```

---

### Task 20: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `docker compose exec server npx tsc --noEmit && docker compose exec client npx tsc --noEmit`
Expected: No type errors in either project

- [ ] **Step 2: Run all client tests**

Run: `docker compose exec client npm test`
Expected: All tests pass

- [ ] **Step 3: Run all server tests**

Run: `docker compose exec server npm test`
Expected: All tests pass

- [ ] **Step 4: Re-seed the database**

Run: `docker compose exec server npx tsx seed.ts`
Expected: Seed completes without errors

- [ ] **Step 5: Manual smoke test**

1. Open the app in browser
2. Verify SupportView: TESSERA | SUPPORT | partner name on left, status + capacity + Ctrl+K + gear + avatar on right
3. Click gear — see labeled rows (language, view mode, focus, dark mode, accessibility, bionic text, notifications)
4. Click avatar — see name, email, account security, sign out
5. Verify AgentView: TESSERA | AGENT | partner name on left, connection dot + gear + avatar on right
6. Verify AdminView: TESSERA | ADMIN | partner name on left, partner switcher + gear + avatar on right
7. Verify PlatformView: TESSERA | PLATFORM on left, gear + avatar on right
8. Verify StatusPicker shows only Online and Away
9. Wait 5 minutes idle — verify auto-away triggers
10. Move mouse — verify auto-online restores

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup for navbar + status simplification"
```
