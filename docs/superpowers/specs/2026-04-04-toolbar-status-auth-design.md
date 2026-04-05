# Toolbar Declutter, Status Simplification & SSO-Only Auth

**Date:** 2026-04-04
**Status:** Draft

---

## 1. Navbar Consistency & Toolbar Declutter

### Problem

The SupportView toolbar has 13 visible controls on the right side. AgentView, AdminView, and PlatformView have similar clutter. Additionally, the left side of the navbar is inconsistent across views — different branding, different structures, missing elements.

### Solution

#### Left Side — Unified Pattern

All views follow the same left-side structure: `[Hamburger] TESSERA [ROLE] | PARTNER NAME`

| View | Left side |
|------|-----------|
| PlatformView | `TESSERA` `PLATFORM` |
| AdminView | `☰` `TESSERA` `ADMIN` `\|` `ACME CORP` |
| SupportView | `☰` `TESSERA` `SUPPORT` `\|` `ACME CORP` |
| AgentView | `☰` `TESSERA` `AGENT` `\|` `ACME CORP` |

Rules:
- **TESSERA brand** always present (product identity)
- **Role badge** always present (inverted colors: light text on dark bg in dark mode, dark text on light bg in light mode)
- **Partner name** shown for all partner-scoped views (Admin, Support, Agent). Always text — no logos in the navbar (logos vary in size/aspect ratio and break the brutalist aesthetic).
- **Hamburger** shown when view has a sidebar (all except Platform)
- Partner logo upload feature remains for other uses (e.g. login screen, emails) but is not displayed in the navbar

#### Right Side — Gear + Avatar

Replace the inline `NavToolbar` component and scattered controls with two shared components:

- **`SettingsPopover`** — gear icon button that opens a popover with labeled rows for preference toggles
- **`UserMenu`** — avatar button (user initials on blue background) that opens a dropdown for identity and account actions

Both components accept configuration props to control which items are shown per view.

### Toolbar Layout Per View

#### PlatformView (right side: 2 items)

| Visible | Details |
|---------|---------|
| Gear | Opens settings popover |
| Avatar | Opens user dropdown |

#### AdminView (right side: 3 items)

| Visible | Details |
|---------|---------|
| Partner Switcher | Existing component, unchanged |
| Gear | Opens settings popover |
| Avatar | Opens user dropdown |

#### SupportView (right side: 5 items)

| Visible | Details |
|---------|---------|
| Status Picker | Existing interactive dropdown (online/away) |
| Team Capacity | Display-only badge (e.g. "2 / 5") |
| Ctrl+K hint | Keyboard shortcut badge |
| Gear | Opens settings popover |
| Avatar | Opens user dropdown |

#### AgentView (right side: 3 items)

| Visible | Details |
|---------|---------|
| Connection Status | Existing connection dot |
| Gear | Opens settings popover |
| Avatar | Opens user dropdown |

### SettingsPopover Content Per View

Labeled rows layout — each row has a label on the left and the control on the right.

| Row | Platform | Admin | Support | Agent |
|-----|----------|-------|---------|-------|
| Language | Yes | Yes | Yes | Yes |
| Dark mode | Yes | Yes | Yes | Yes |
| Accessibility | No | No | Yes | Yes |
| Bionic text | No | Yes | Yes | Yes |
| Notifications | No | No | Yes | Yes |
| View mode | No | No | Yes | No |
| Focus mode | No | No | Yes | No |

### UserMenu Content Per View

| Row | Platform | Admin | Support | Agent |
|-----|----------|-------|---------|-------|
| Name + email | Yes | Yes | Yes | Yes |
| Feedback | No | No | No | Yes |
| Account Security | Yes (local) | No | No | No |
| Sign out | Yes | Yes | Yes | Yes |

Account Security only appears for platform operators (the only users with local auth). See section 3.

### Components Affected

| Action | Component |
|--------|-----------|
| **Create** | `client/src/components/SettingsPopover.tsx` |
| **Create** | `client/src/components/UserMenu.tsx` |
| **Delete** | `client/src/components/NavToolbar.tsx` |
| **Modify** | `client/src/components/support/SupportNav.tsx` — replace NavToolbar + scattered items with SettingsPopover + UserMenu |
| **Modify** | `client/src/components/agent/AgentNav.tsx` — replace NavToolbar + feedback button + sign out with SettingsPopover + UserMenu |
| **Modify** | `client/src/views/AdminView.tsx` — replace inline toolbar with SettingsPopover + UserMenu |
| **Modify** | `client/src/views/PlatformView.tsx` — replace inline toolbar with SettingsPopover + UserMenu |
| **Modify** | `client/src/components/BusinessHoursGuard.tsx` — replace hardcoded navbar with unified pattern (TESSERA + AGENT + partner name, gear + avatar). Replace hardcoded colors (`bg-white text-black dark:bg-black`) with CSS custom property tokens. |

### Popover Behavior

- Click gear/avatar to open, click again or click outside to close
- Only one popover open at a time (opening gear closes avatar and vice versa)
- No decorative animations — instant open/close per brutalist spec
- Popover anchored to button, aligned to right edge, drops downward
- Keyboard: Escape closes, Tab navigates within

---

## 2. Status Simplification

### Problem

5 agent statuses (available, break, lunch, meeting, training) are too granular. Admins don't need to know the reason someone is unavailable — they just need to see availability for staffing.

### Solution

Reduce to 2 statuses:

| Status | Meaning | Color | Token |
|--------|---------|-------|-------|
| **Online** | Available, picking up tickets | Green | `accent-green` |
| **Away** | Not available | Amber | `accent-amber` |

### Triggers

- **Manual**: Agent clicks status picker to toggle between online and away
- **Auto-away**: After 5 minutes of inactivity, status automatically changes to away. Reuses existing `useIdleStatus` hook with simplified logic. Activity (mouse move, keypress, socket event) resets the timer and sets status back to online.

### Database Changes

#### `agent_status_log` table

- `status` column: remove `available`, `break`, `lunch`, `meeting`, `training` values
- New values: `online`, `away`
- Migration: map `available` → `online`, all others → `away`

#### `daily_agent_status` table

Current columns: `availableSeconds`, `breakSeconds`, `lunchSeconds`, `meetingSeconds`, `trainingSeconds`

New columns: `onlineSeconds`, `awaySeconds`

Migration: `onlineSeconds` = `availableSeconds`, `awaySeconds` = sum of all others.

#### `statusEnum` pgEnum

Replace 5 values with 2. Drizzle migration required.

### Service Changes

| File | Change |
|------|--------|
| `server/services/statusTracking.ts` | Simplify to 2 statuses, update rollup aggregation |
| `server/services/presence.ts` | Update Redis status values, Lua script for re-identify |
| `server/trpc/routers/status.ts` | Update getTeamStatus, getAgentStats, getTeamStats |
| `server/socket/handlers.ts` | `status:set` event accepts only `online` or `away` |

### Client Changes

| File | Change |
|------|--------|
| `client/src/components/StatusPicker.tsx` | 2 options instead of 5 |
| `client/src/components/support/QueueSidebar.tsx` | Update team panel status display |
| `client/src/components/admin/AdminTeam.tsx` | Update status column |
| `client/src/components/admin/AgentStatusStats.tsx` | Simplify charts to online/away |
| `client/src/components/admin/AdminStats.tsx` | Update any status references |
| `client/src/utils/statusColors.ts` | Simplify `getStatusColors` and `getStatusI18nKey` |
| `client/src/hooks/useIdleStatus.ts` | Simplify: only auto-away after 5min idle, auto-online on activity |

### Translation Keys

Remove: `status_break`, `status_lunch`, `status_meeting`, `status_training`
Keep/rename: `status_available` → `status_online`, add `status_away`
Update in all 3 locales (en, nl, fr).

### Color Tokens

Remove: `accent-orange` (lunch), `accent-red` (meeting), `accent-blue` (training) from status usage.
Keep: `accent-green` (online), `accent-amber` (away).
Note: these color tokens may still be used elsewhere in the app — only remove from status context.

---

## 3. SSO-Only Auth

### Problem

Local auth (passwords, MFA, lockout, reset flows) adds significant complexity. Enterprise customers use SSO. Building and maintaining local auth for partners is unnecessary at this stage.

### Solution

Remove local auth for all partner users. Keep local auth only for platform operators as a bootstrap mechanism.

### Auth Model

| User Type | Auth Methods | Password | MFA | Lockout |
|-----------|-------------|----------|-----|---------|
| Platform operator | Local + SSO (once configured) | Yes | Yes (self-managed TOTP) | Yes |
| Partner users (admin, support, agent) | SSO only | No | IdP handles | IdP handles |

### Platform Operator Flow

1. **Day 1**: Operator logs in with email + password (bootstrapped from `PLATFORM_ADMIN_EMAIL` env var)
2. **Configures SSO** for partner organizations
3. **Optionally links SSO** for their own account — can now use either method
4. **Daily use**: SSO login like everyone else
5. **Fallback**: Local login always available if IdP is down

### Login Screen

- Primary: SSO button (for all users)
- Secondary: Small "Platform admin login" link at bottom that reveals email + password form
- Clean separation — 99% of users only see the SSO button

### What Gets Removed (Partner-Facing)

| Feature | Current State | After |
|---------|--------------|-------|
| Password hashing for partners | Argon2id | Removed |
| Temp password on invite | Generated | Removed — invite maps SSO identity |
| Password policies | Min 10, complexity, history | Platform operators only |
| Account lockout | 5 attempts / 15 min | Platform operators only |
| MFA/TOTP for partners | Optional per user | Removed — IdP handles |
| Password reset flow | Email-based | Removed for partners |
| Change password UI | Security modal | Platform operators only |
| `UserSecurityModal` | All users | Platform operators only (password + MFA). Partner users see notification preferences only (moved to gear popover). |

### What Stays

| Feature | Scope |
|---------|-------|
| Platform operator local auth | Full: password, MFA, lockout, change password |
| SSO/SAML/OIDC flows | All partner users |
| Session management (JWT cookies) | All users |
| Refresh tokens | All users |
| `authMethod` per partner | Simplified: always `sso` for partners |
| Audit logging | All users |

### Database Changes

- `users.password` — nullable (null for SSO-only users, populated for platform operators)
- `users.mfaSecret`, `mfaEnabledAt`, `mfaRecoveryCodes` — platform operators only
- `users.failedLoginAttempts`, `lockedUntil` — platform operators only
- `partners.authMethod` — default to `sso`, remove `local` and `both` options for now
- `password_history` checks — platform operators only

### Service Changes

| File | Change |
|------|--------|
| `server/routes/auth.ts` | Login: SSO redirect for partner users, local form for platform operators only |
| `server/services/accountLockout.ts` | Guard: only apply to platform operators |
| `server/services/mail.ts` / `mailTemplates.ts` | Remove partner password emails. Keep lockout/MFA emails for operators. |
| `server/services/bootstrap.ts` | Unchanged — still creates platform operator with local password |
| `server/trpc/routers/mfa.ts` | Guard: only platform operators can access. Partner users calling any mfa.* procedure get a permission error. |
| `server/services/platformStepUp.ts` | Unchanged — already platform-operator only |
| `server/trpc/routers/user.ts` | `changePassword`: only platform operators. `invite`: no temp password for partner users. |
| `server/routes/sso.ts` | Becomes the primary auth path for all partner users |

### Migration Strategy

This is a breaking change for existing partner users with local passwords. Migration approach:

1. All existing partner users get `password` set to null
2. Partners' `authMethod` set to `sso`
3. Admins must configure SSO for each partner before users can log in again
4. Platform operators retain their local credentials

---

## 4. Notification Preferences

### Current Location

Inside `UserSecurityModal` — mixed in with password and MFA settings.

### New Location

- For platform operators: stays in `UserSecurityModal` (alongside password + MFA)
- For partner users: moved to `SettingsPopover` as a row that opens a sub-panel or inline toggles

This keeps the gear popover as the single location for all user preferences.

---

## 5. Summary of Scope

| Area | Change |
|------|--------|
| New components | `SettingsPopover`, `UserMenu` |
| Deleted components | `NavToolbar` |
| Modified views | All 4 (Platform, Admin, Support, Agent) |
| Database migrations | Status enum (5→2), daily_agent_status columns, partner authMethod default |
| Removed services | Partner password flows, partner MFA/TOTP, partner lockout (code stays but guarded to platform operators only). Platform step-up TOTP unchanged. |
| Translation keys | Remove 3 status keys, remove `my_stats`, update auth-related keys |
