# Clickable Past Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make past ticket rows in TicketSidebar clickable, opening a read-only message preview in the chat area via the existing TicketPreview component.

**Architecture:** Add `readOnly` prop to TicketPreview (hides footer, changes badge text). Add `onPreviewTicket` callback to TicketSidebar (makes rows clickable). Wire them together in SupportView via existing `setPreviewTicket` state.

**Tech Stack:** React 19, tRPC, Tailwind CSS 4, CSS custom properties

---

### Task 1: Add `readOnly` Prop to TicketPreview

**Files:**
- Modify: `client/src/components/TicketPreview.tsx`

- [ ] **Step 1: Update the interface**

In `client/src/components/TicketPreview.tsx`, replace lines 12-18:

```typescript
interface TicketPreviewProps {
  ticket: Ticket;
  messages?: Message[];
  onJoin: () => void;
  onClose: () => void;
  joinDisabled?: boolean;
}
```

with:

```typescript
interface TicketPreviewProps {
  ticket: Ticket;
  messages?: Message[];
  onJoin?: () => void;
  onClose: () => void;
  joinDisabled?: boolean;
  readOnly?: boolean;
}
```

- [ ] **Step 2: Destructure the new prop**

In `client/src/components/TicketPreview.tsx`, replace line 20:

```typescript
export default function TicketPreview({ ticket, messages: propMessages, onJoin, onClose, joinDisabled }: TicketPreviewProps) {
```

with:

```typescript
export default function TicketPreview({ ticket, messages: propMessages, onJoin, onClose, joinDisabled, readOnly }: TicketPreviewProps) {
```

- [ ] **Step 3: Change the header badge text**

In `client/src/components/TicketPreview.tsx`, replace line 48-50:

```tsx
            <span className="badge bg-accent-blue text-[var(--color-btn-text-inverse)] shrink-0">
              {t('preview_mode')}
            </span>
```

with:

```tsx
            <span className="badge bg-accent-blue text-[var(--color-btn-text-inverse)] shrink-0">
              {readOnly ? (t('history_mode') || 'HISTORY') : t('preview_mode')}
            </span>
```

- [ ] **Step 4: Conditionally hide the footer**

In `client/src/components/TicketPreview.tsx`, replace lines 93-112:

```tsx
        {/* Join bar */}
        <div className="px-6 py-4 border-t border-border bg-bg-surface flex items-center justify-between gap-4">
          {ticket.status === 'closed' ? (
            <p className="text-sm font-bold uppercase text-text-muted">{t('conversation_closed')}</p>
          ) : (
            <>
              <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{t('waiting_for_expert')}</p>
              <button
                onClick={onJoin}
                disabled={joinDisabled}
                className={`px-8 py-3 text-xs font-bold uppercase tracking-widest ${joinDisabled
                  ? 'btn-secondary opacity-20 cursor-not-allowed'
                  : 'btn-primary'
                  }`}
              >
                {t('join')}
              </button>
            </>
          )}
        </div>
```

with:

```tsx
        {/* Join bar — hidden in read-only mode */}
        {!readOnly && (
          <div className="px-6 py-4 border-t border-border bg-bg-surface flex items-center justify-between gap-4">
            {ticket.status === 'closed' ? (
              <p className="text-sm font-bold uppercase text-text-muted">{t('conversation_closed')}</p>
            ) : (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-text-muted">{t('waiting_for_expert')}</p>
                <button
                  onClick={onJoin}
                  disabled={joinDisabled}
                  className={`px-8 py-3 text-xs font-bold uppercase tracking-widest ${joinDisabled
                    ? 'btn-secondary opacity-20 cursor-not-allowed'
                    : 'btn-primary'
                    }`}
                >
                  {t('join')}
                </button>
              </>
            )}
          </div>
        )}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/TicketPreview.tsx
git commit -m "feat(preview): add readOnly prop to TicketPreview — hides footer, shows HISTORY badge"
```

---

### Task 2: Make Past Ticket Rows Clickable in TicketSidebar

**Files:**
- Modify: `client/src/components/support/TicketSidebar.tsx`

- [ ] **Step 1: Add `onPreviewTicket` to the props interface**

In `client/src/components/support/TicketSidebar.tsx`, replace lines 14-16:

```typescript
interface TicketSidebarProps {
  ticket: Ticket;
}
```

with:

```typescript
interface TicketSidebarProps {
  ticket: Ticket;
  onPreviewTicket?: (ticket: Ticket) => void;
}
```

- [ ] **Step 2: Destructure the new prop**

In `client/src/components/support/TicketSidebar.tsx`, replace line 18:

```typescript
export default function TicketSidebar({ ticket }: TicketSidebarProps) {
```

with:

```typescript
export default function TicketSidebar({ ticket, onPreviewTicket }: TicketSidebarProps) {
```

- [ ] **Step 3: Make past ticket rows clickable**

In `client/src/components/support/TicketSidebar.tsx`, replace lines 92-103:

```tsx
              {pastList.slice(0, 5).map((tk) => (
                <div key={tk.id} className="surface-card">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">
                      {tk.dept}
                    </span>
                    <span className="mono-label opacity-60 uppercase">{tk.status}</span>
                  </div>
                  <span className="mono-timestamp">
                    {new Date(tk.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
```

with:

```tsx
              {pastList.slice(0, 5).map((tk) => (
                <div
                  key={tk.id}
                  className={`surface-card ${onPreviewTicket ? 'cursor-pointer hover:bg-[var(--color-bg-elevated)]' : ''}`}
                  onClick={() => onPreviewTicket?.(tk)}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[8px] border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] px-1.5 py-0.5 uppercase">
                      {tk.dept}
                    </span>
                    <span className="mono-label opacity-60 uppercase">{tk.status}</span>
                  </div>
                  <span className="mono-timestamp">
                    {new Date(tk.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/support/TicketSidebar.tsx
git commit -m "feat(sidebar): make past ticket rows clickable with onPreviewTicket callback"
```

---

### Task 3: Wire TicketSidebar to SupportView Preview State

**Files:**
- Modify: `client/src/views/SupportView.tsx`

- [ ] **Step 1: Pass `onPreviewTicket` to TicketSidebar**

In `client/src/views/SupportView.tsx`, replace lines 301-304:

```tsx
            {/* Ticket context sidebar (only in normal mode) */}
            {activeTab && !showPreview && !focusMode && viewMode === 'normal' && (() => {
              const activeTicket = tickets.find((tk) => tk.id === activeTab);
              return activeTicket ? <TicketSidebar ticket={activeTicket} /> : null;
            })()}
```

with:

```tsx
            {/* Ticket context sidebar (only in normal mode) */}
            {activeTab && !showPreview && !focusMode && viewMode === 'normal' && (() => {
              const activeTicket = tickets.find((tk) => tk.id === activeTab);
              return activeTicket ? <TicketSidebar ticket={activeTicket} onPreviewTicket={setPreviewTicket} /> : null;
            })()}
```

- [ ] **Step 2: Pass `readOnly` to TicketPreview for closed/resolved tickets**

In `client/src/views/SupportView.tsx`, replace lines 279-285:

```tsx
              ) : showPreview ? (
                <TicketPreview
                  ticket={previewTicket!}
                  onJoin={() => joinTicket(previewTicket!)}
                  onClose={() => setPreviewTicket(null)}
                  joinDisabled={atMaxChats}
                />
```

with:

```tsx
              ) : showPreview ? (
                <TicketPreview
                  ticket={previewTicket!}
                  onJoin={previewTicket!.status === 'closed' || previewTicket!.status === 'resolved' ? undefined : () => joinTicket(previewTicket!)}
                  onClose={() => setPreviewTicket(null)}
                  joinDisabled={atMaxChats}
                  readOnly={previewTicket!.status === 'closed' || previewTicket!.status === 'resolved'}
                />
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Verify the app builds**

Run: `docker compose exec client npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add client/src/views/SupportView.tsx
git commit -m "feat(support): wire past ticket click to read-only TicketPreview"
```

---

### Task 4: Manual Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Verify past ticket rows are clickable**

1. Log in as support, open a ticket for a customer with past history
2. Expand the right sidebar
3. Confirm past ticket rows show pointer cursor on hover
4. Click a past ticket row

- [ ] **Step 2: Verify read-only preview**

1. Confirm the chat area shows TicketPreview with "HISTORY" badge (not "PREVIEW")
2. Confirm messages load and display correctly
3. Confirm there is NO Join/Close footer bar
4. Confirm the "×" close button works and returns to the active chat

- [ ] **Step 3: Verify normal preview still works**

1. Click an unjoined ticket from the queue sidebar
2. Confirm it shows "PREVIEW" badge with Join button (normal behavior preserved)
3. Confirm Join works as expected
