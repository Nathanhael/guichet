# Tessera Brutalist Redesign — Design Spec

**Date**: 2026-03-26
**Branch**: `feature/brutalist-redesign` (to be created)
**Scope**: Full frontend visual redesign — zero backend changes

## 1. Design Philosophy

Raw/Exposed Brutalism. The UI exposes its structure honestly. Every panel has visible borders. No decorative elements. Typography and spacing do all the work. The interface looks like a tool, not a product marketing page.

This replaces the previous strict B&W monochromatic mandate with a brutalist design system that uses color purposefully.

## 2. Color System

### Dark Mode (Primary)

| Token               | Hex       | Usage                                      |
|---------------------|-----------|---------------------------------------------|
| `bg-base`           | `#09090b` | Main background                             |
| `bg-surface`        | `#18181b` | Cards, panels, input fields                 |
| `bg-elevated`       | `#27272a` | Hover states, received message bubbles      |
| `border`            | `#27272a` | Panel dividers, input borders               |
| `border-heavy`      | `#3f3f46` | Section dividers, emphasized borders        |
| `text-primary`      | `#e4e4e7` | Main content text                           |
| `text-secondary`    | `#a1a1aa` | Descriptions, metadata                      |
| `text-muted`        | `#52525b` | Labels, placeholders, timestamps            |
| `text-faint`        | `#3f3f46` | Disabled text, subtle metadata              |
| `accent-blue`       | `#3b82f6` | Active states, own messages, links, primary |
| `accent-blue-light` | `#60a5fa` | Own message sender label                    |
| `accent-purple`     | `#a855f7` | Pending status, whisper messages             |
| `accent-red`        | `#ef4444` | Urgent, errors, destructive actions         |
| `accent-green`      | `#22c55e` | Online status, success, resolved            |
| `own-msg-bg`        | `#1e3a5f` | Sent message background                    |
| `whisper-bg`        | `#1a1520` | Whisper message background                 |

### Light Mode (L2 Warm Stone)

| Token               | Hex       | Usage                                      |
|---------------------|-----------|---------------------------------------------|
| `bg-base`           | `#fafaf9` | Main background                             |
| `bg-surface`        | `#ffffff` | Cards, panels                               |
| `bg-elevated`       | `#f5f5f4` | Hover, received message bubbles             |
| `border`            | `#d6d3d1` | Panel dividers, input borders               |
| `border-heavy`      | `#1c1917` | Section dividers, nav bottom border         |
| `text-primary`      | `#1c1917` | Main content text                           |
| `text-secondary`    | `#57534e` | Descriptions, metadata                      |
| `text-muted`        | `#a8a29e` | Labels, placeholders                        |
| `text-faint`        | `#d6d3d1` | Disabled text                               |
| `accent-blue`       | `#2563eb` | Active states, own messages, links, primary |
| `accent-purple`     | `#7c3aed` | Pending status, whisper messages             |
| `accent-red`        | `#ef4444` | Urgent, errors, destructive actions         |
| `accent-green`      | `#16a34a` | Online status, success, resolved            |
| `own-msg-bg`        | `#eff6ff` | Sent message background                    |
| `whisper-bg`        | `#faf5ff` | Whisper message background                 |

### Implementation

Define tokens as CSS custom properties in `index.css` `@theme` block. Dark/light switching via existing `.dark` class on root element + Zustand `config` slice.

## 3. Typography System

### Fonts

| Font            | Role             | Load method                          |
|-----------------|------------------|---------------------------------------|
| JetBrains Mono  | UI chrome        | Self-hosted in `/public/fonts/`       |
| Inter           | Content text     | Already loaded (existing)             |
| Lexend          | Dyslexic mode    | Already loaded (existing, keep as-is) |

### Type Scale

| Element                | Font           | Size    | Weight | Transform                 |
|------------------------|----------------|---------|--------|---------------------------|
| App title (TESSERA)    | JetBrains Mono | 13px    | 700    | uppercase, tracking 3px   |
| Section headers        | JetBrains Mono | 9-10px  | 500    | uppercase, tracking 1px   |
| Nav items              | JetBrains Mono | 10px    | 500    | uppercase, tracking 1px   |
| Badges/status          | JetBrains Mono | 8-9px   | 700    | uppercase                 |
| Ticket IDs             | JetBrains Mono | 10-11px | 700    | normal case               |
| Timestamps             | JetBrains Mono | 8-9px   | 400    | normal case               |
| Buttons                | JetBrains Mono | 10-11px | 700    | uppercase, tracking 1px   |
| Message body           | Inter          | 13px    | 400    | normal case               |
| Ticket descriptions    | Inter          | 12-13px | 400    | normal case               |
| Form inputs            | Inter          | 13px    | 400    | normal case               |
| Input placeholders     | JetBrains Mono | 11px    | 400    | uppercase                 |
| Page titles            | Inter          | 18-20px | 700    | uppercase                 |

### Key Rule

Monospace = UI structure (nav, labels, badges, buttons, IDs, timestamps). Sans-serif = human-written content (messages, descriptions, input values).

## 4. Layout System

### Shell (all views)

- Top nav bar: `TESSERA` logo left, view tabs center/right, user info + theme toggle far right
- 1px border bottom separating nav from content (dark: `#27272a`, light: `#1c1917` heavy)
- Content area below adapts per view

### SupportView (primary workspace)

- **Default state**: 3-column CSS Grid — collapsible sidebar (ticket queue, 240px) | chat area (1fr) | customer info panel (220px)
- **Collapsed sidebar**: Icon rail (32px) with vertical monospace labels, click to expand
- **Focus mode**: Click a ticket → full-width chat view, customer info inline in top bar, `← BACK` button returns to queue view
- 1px zinc borders between all panels

### AdminView

- Keep existing collapsible sidebar nav pattern
- Restyle with brutalist tokens (bordered cards, monospace headers)

### PlatformView

- Top tab navigation
- Tables with full cell borders, monospace headers, no zebra striping

### AgentView (end-user)

- Ticket list left, chat right (2-column)
- Focus mode on narrow viewports (single column)

### LoginView

- Centered form with thick border (2px dark)
- Monospace labels, Inter input values
- Raw aesthetic — no decorative elements

## 5. Component Library

### Buttons

- Font: JetBrains Mono, 10-11px, weight 700, uppercase, tracking 1px
- Border-radius: 0 (square)
- Primary: `accent-blue` background, white text
- Secondary: transparent background, bordered (`border` token), primary text color
- Danger: transparent background, `accent-red` border and text
- Small variant: 9px font, reduced padding (4px 12px)
- No transitions on hover — instant state change

### Inputs

- Border: 1px `border` token, 0 radius
- Background: `bg-surface`
- Placeholder: JetBrains Mono, uppercase, `text-muted`
- Value text: Inter, 13px, `text-primary`
- Focus: border changes to `accent-blue`

### Cards/Panels

- 1px border (`border` token), 0 radius, no shadow
- Section header: JetBrains Mono, 9px, uppercase, `text-muted`

### Modals

- Centered, 1px border, backdrop at 80% opacity
- Title: JetBrains Mono, uppercase
- Body: Inter, normal case

### Toast Notifications

- Fixed top-right positioning
- Success: inverted colors (light text on dark bg / dark text on light bg)
- Error: `accent-red` background, white text
- Font: JetBrains Mono, 10px, uppercase

### Badges

- JetBrains Mono, 8-9px, weight 700, uppercase
- Status badges: filled background (OPEN = blue, URGENT = red)
- Category badges: bordered only (no fill), square shape
- 0 border-radius (no pills), except avatar circles (`rounded-full` on user monogram elements)

### Chat Bubbles

- Border-radius: 1px (near-zero)
- Received: `bg-elevated` background
- Sent: `own-msg-bg` background + 2px left border in `accent-blue`
- Whisper: purple-tinted background + 2px left border in `accent-purple`
- Sender label: JetBrains Mono, 8px
- Body: Inter, 13px, normal case
- Timestamp: JetBrains Mono, 8px, `text-faint`

### Tables

- Full borders on all cells (1px `border` token)
- Headers: JetBrains Mono, 9px, uppercase, `text-muted`
- Cell data: Inter, 11px
- Monospace for IDs, roles, technical data
- No zebra striping

## 6. Animations

Minimal functional motion only:

- `fade-in`: 150ms, opacity 0→1, for panels/modals appearing
- Functional layout transitions (sidebar collapse, tab switch) permitted at ≤150ms
- No decorative slides, bounces, or spring animations
- Instant state changes for hover, active, focus states
- `prefers-reduced-motion` media query disables all motion

This replaces the previous "ZERO MOTION" mandate.

## 7. Dark Mode Implementation

- Existing mechanism preserved: `.dark` class on root element, toggled via Zustand `config` slice
- All color tokens defined as CSS custom properties with dark-mode overrides via `@custom-variant dark`
- Toggle icon in nav: ☀ (in dark mode, switches to light) / ☾ (in light mode, switches to dark)

## 8. Font Loading

Self-host JetBrains Mono in `/public/fonts/` for Docker/offline reliability:

- `JetBrains-Mono-Regular.woff2` (400)
- `JetBrains-Mono-Medium.woff2` (500)
- `JetBrains-Mono-Bold.woff2` (700)

Declare via `@font-face` in `index.css`. Use `font-display: swap` for performance.

## 9. Migration Strategy

### What Changes

- Color system: B&W → Zinc + Blue dual-theme CSS custom properties in `index.css`
- Typography: Inter-only → JetBrains Mono (UI) + Inter (content)
- Borders: Mixed 1-4px → Consistent 1px zinc, 2px dark for section dividers
- Border radius: Various → 0-1px everywhere
- Text transform: All uppercase → UI chrome only
- Buttons: Rewrite `btn-primary`/`btn-secondary` utilities with new tokens
- Layout: Flexbox → CSS Grid for main panel structure, flexbox within panels
- Chat bubbles: Rewrite `bubble-sent`/`bubble-received`/`bubble-whisper` utilities
- Custom utilities: Replace `surface-card`, `surface-panel`, `input-field` with new token-based versions

### What Stays

- Zustand store architecture (all slices unchanged)
- Component file structure (views, hooks, store)
- Tailwind CSS 4 with `@theme` block
- `lucide-react` icons
- All tRPC hooks, socket handlers, business logic
- Dark mode toggle mechanism (`.dark` class)
- Lexend font for dyslexic mode

### Rollout Order

Each view is a self-contained step. Nothing breaks between steps.

1. **Foundation** — Design tokens in `index.css`, font loading, shared utility classes
2. **LoginView** — Simplest view, validates the design system works end-to-end
3. **PlatformView** — Tables, modals, partner management (standalone components)
4. **AdminView** — Sidebar nav, settings panels, department/label management
5. **SupportView** — Queue, chat, customer info (most complex, done last with proven foundation)
6. **AgentView** — End-user ticket creation and chat

### Branch Strategy

- Branch: `feature/brutalist-redesign`
- All work on this branch — `main` stays untouched
- One commit per view/step for clean history

## 10. CLAUDE.md Updates Required

After implementation, update CLAUDE.md to reflect:

- Remove "STRICT B&W" mandate → replace with brutalist design system reference
- Remove "ZERO MOTION" mandate → replace with "minimal functional motion" policy
- Update aesthetics section with new font and color system
- Add reference to this design spec

## 11. Files Affected

| File | Change |
|------|--------|
| `client/src/index.css` | Design tokens, `@font-face`, utility classes rewrite |
| `client/index.html` | Remove Google Fonts link if switching to self-hosted |
| `client/public/fonts/` | New directory: JetBrains Mono woff2 files |
| `client/src/views/LoginView.tsx` | Restyle |
| `client/src/views/PlatformView.tsx` | Restyle |
| `client/src/views/AdminView.tsx` | Restyle |
| `client/src/views/SupportView.tsx` | Restyle + grid layout + focus mode |
| `client/src/views/AgentView.tsx` | Restyle |
| `client/src/components/ConfirmDialog.tsx` | Restyle |
| `client/src/components/Toast.tsx` | Restyle |
| `client/src/components/platform/*.tsx` | Restyle all platform components |
| `CLAUDE.md` | Update design mandates |

## 12. Visual Reference

Interactive mockup saved at:
`.superpowers/brainstorm/1669-1774546336/content/full-design-preview.html`

Open locally to see both dark and light themes with full SupportView and component library.
