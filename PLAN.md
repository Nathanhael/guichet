# Tessera — Sprint Plan

---

# Completed Work

<details>
<summary>Previous Sprint (2026-03-24) — All Done ✅</summary>

- Feature 1: MFA Admin Management ✅
- Feature 2: Notification Preferences ✅
- Feature 3: API Documentation ✅
- Security Hardening (12 items) ✅

</details>

---

# Sprint 1 — AI, UX & Platform Improvements

**Created**: 2026-03-24
**Status**: Ready to implement

---

## Feature 0: AI Provider Abstraction Layer (Prerequisite)

**Size**: Medium
**Problem**: Features 1–6 all assume an AI provider is available, but no provider layer exists. There's no `server/services/ai/` directory, no way to call Ollama or Azure OpenAI, and no usage tracking. This is the engine everything else depends on.

### Backend

#### Provider Interface

**New directory**: `server/services/ai/`

**File**: `server/services/ai/types.ts`

```typescript
interface AiProvider {
  chat(params: ChatParams): Promise<ChatResult>;
  chatStream(params: ChatParams): AsyncIterable<string>;
  isAvailable(): Promise<boolean>;
}

interface ChatParams {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

interface ChatResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}
```

#### Provider Implementations

| File | Provider | Notes |
|------|----------|-------|
| `server/services/ai/ollama.ts` | Ollama (local) | Uses `OLLAMA_HOST` (already in docker-compose). NDJSON streaming. Free, no API key. |
| `server/services/ai/azure-openai.ts` | Azure OpenAI (o4-mini) | Uses `AI_BASE_URL` + `AI_API_KEY`. SSE streaming. Per-deployment model selection. |
| `server/services/ai/openai-compatible.ts` | Generic OpenAI-compatible | Works with LM Studio, Groq, Together AI, vLLM. Standard `/v1/chat/completions`. |

**File**: `server/services/ai/factory.ts`

```typescript
function getProvider(partnerId?: string): AiProvider
```

1. If `partnerId` provided, check `partners.ai_provider` + `partners.ai_config`
2. Fall back to global `AI_PROVIDER` env var
3. Cache provider instances per config hash

Switch provider with one env var:
```
AI_PROVIDER=ollama          # dev (local, free)
AI_PROVIDER=azure-openai    # production (o4-mini)
```

#### Database

**Migration**: `server/drizzle/0012_ai_service_layer.sql`

Add to `partners` table:
```sql
ALTER TABLE partners ADD COLUMN ai_enabled boolean DEFAULT false;
ALTER TABLE partners ADD COLUMN ai_provider text DEFAULT 'ollama';
ALTER TABLE partners ADD COLUMN ai_model text;
ALTER TABLE partners ADD COLUMN ai_config jsonb DEFAULT '{}';
```

New table: `ai_prompt_templates`
- `id` text PK
- `partner_id` text FK (nullable = system default)
- `action` text NOT NULL — `'classify'`, `'suggest'`, `'summarize'`, `'improve'`, `'translate'`, `'sentiment'`, `'match_canned'`
- `template` text NOT NULL — prompt with `{{variables}}`
- `model` text — override model per action
- UNIQUE(`partner_id`, `action`)

New table: `ai_usage_log`
- `id` text PK
- `partner_id` text FK
- `user_id` text FK
- `action` text NOT NULL
- `provider` text NOT NULL
- `model` text NOT NULL
- `input_tokens` integer
- `output_tokens` integer
- `latency_ms` integer
- `success` boolean
- `error_message` text
- `created_at` timestamp
- INDEX(`partner_id`, `created_at`)

#### Rate Limiting

**File**: `server/services/ai/rateLimit.ts`

Per-partner Redis counters:
- `ai:rate:{partnerId}:minute` — max 30 requests/min (default)
- `ai:rate:{partnerId}:day` — max 1000 requests/day (default)
- Configurable via `partners.ai_config.rateLimits`
- Auto-fallback to Ollama if Azure OpenAI budget exceeded

#### Socket.io Streaming

**File**: `server/socket/handlers.ts` (additions)

For real-time AI in the agent chat panel:
```
Agent clicks "Suggest Reply"
    → socket.emit('ai:suggest', { ticketId })
    ← socket.on('ai:suggest:chunk', { text })   // streaming tokens
    ← socket.on('ai:suggest:done')               // complete
```

Same pattern for summarize, translate. Sentiment runs async (no streaming needed).

### Test Plan

- [ ] Ollama provider connects and returns chat completions
- [ ] Azure OpenAI provider connects with API key and returns completions
- [ ] Factory resolves correct provider based on env var
- [ ] Factory resolves per-partner provider when configured
- [ ] Streaming returns chunks via AsyncIterable
- [ ] `isAvailable()` returns false when provider is unreachable
- [ ] Usage logged to `ai_usage_log` for every call
- [ ] Rate limiting blocks requests when exceeded
- [ ] Prompt templates loaded from DB, falling back to built-in defaults
- [ ] Socket.io streaming events emit chunks correctly

---

## Feature 1: Per-Tenant AI Configuration

**Size**: Small
**Problem**: AI features are globally on/off via `AI_ENABLED` env var. Platform admins need granular control per tenant — some tenants may not want AI (compliance, privacy), and features should be rollout-able incrementally.

### Backend

**Database**: Add `aiFeatures` JSONB column to `partners` table (or store in `systemSettings` per partner).

```typescript
interface PartnerAiConfig {
  messageImprovement?: boolean;   // default false
  chatSummarization?: boolean;    // default false
  translation?: boolean;          // default false
  sentimentDetection?: boolean;   // default false
  autoSummarizeOnClose?: boolean; // default false
}
```

**File**: `server/trpc/routers/platform.ts`

1. **Update `editPartner`** — accept `aiFeatures` in input, merge into partner record
2. **New helper: `getPartnerAiConfig(partnerId)`** — returns merged config (global `AI_ENABLED` must be true AND per-partner feature must be enabled)

All AI service calls must check `getPartnerAiConfig()` before executing.

### Frontend

**File**: `client/src/components/platform/EditPartnerModal.tsx`

Add "AI Features" section with toggle switches:
- Message Improvement: On/Off
- Chat Summarization: On/Off
- Translation: On/Off
- Sentiment Detection: On/Off
- Auto-Summarize on Close: On/Off

Show a warning if global `AI_ENABLED` is off: "AI is globally disabled. Enable it in environment configuration first."

### Test Plan

- [ ] Platform admin can toggle individual AI features per partner
- [ ] AI features respect both global `AI_ENABLED` and per-partner toggles
- [ ] Disabled AI feature returns appropriate error/no-op when called
- [ ] Default config has all features off (opt-in model)
- [ ] Non-platform users cannot modify AI config

---

## Feature 2: AI Message Improvement

**Size**: Small-Medium
**Problem**: Agents sometimes write vague problem descriptions, and support staff sometimes write unclear instructions. AI can improve both sides for better communication.

### Backend

**File**: `server/trpc/routers/message.ts` (or new `server/trpc/routers/ai.ts`)

1. **New procedure: `ai.improveMessage`**
   - Input: `{ text: string, role: 'agent' | 'support', partnerId: string }`
   - Guard: `protectedProcedure` + check partner AI config (`messageImprovement` enabled)
   - Logic:
     ```
     1. Check partner AI config allows messageImprovement
     2. Call AI provider with role-specific prompt:
        - Agent role: "Rewrite this support request to be clearer and more structured"
        - Support role: "Rewrite these instructions to be clear, step-by-step, and actionable"
     3. Return { improved: string }
     ```
   - Rate limit: max 10 improvements per user per hour

### Frontend

**Files**: `client/src/components/ChatWindow.tsx`

Add a "✨ Improve" button next to the message input (both AgentView and SupportView):
- Button appears when text is entered (min 10 characters)
- Click → calls `ai.improveMessage` → replaces input text with improved version
- User can edit the result before sending
- Show original text in a collapsible "Original" section so they can revert
- Loading state while AI processes
- Button hidden if partner's `messageImprovement` is disabled

### Test Plan

- [ ] "Improve" button appears for agents and support when typing
- [ ] Improved text replaces input content
- [ ] User can revert to original text
- [ ] Feature disabled when partner AI config has `messageImprovement: false`
- [ ] Rate limiting prevents abuse
- [ ] Works with all configured AI providers

---

## Feature 3: AI Chat Summarization

**Size**: Small-Medium
**Problem**: When a support staff member picks up a long ticket thread (or a different support person takes over), they have to read the entire conversation to understand context.

### Backend

**File**: `server/trpc/routers/ai.ts`

1. **New procedure: `ai.summarizeChat`**
   - Input: `{ ticketId: string }`
   - Guard: `protectedProcedure` (support/admin only) + check partner AI config (`chatSummarization` enabled)
   - Logic:
     ```
     1. Fetch all messages for the ticket
     2. Call AI provider: "Summarize this support conversation in 2-3 sentences. Include: the problem, what's been tried, current status."
     3. Return { summary: string }
     ```
   - Cache the summary (store on ticket or in Redis with TTL) — invalidate when new messages arrive

### Frontend

**File**: `client/src/components/ChatWindow.tsx`

- Add a "Summarize" button in the chat header (support/admin view only)
- Click → shows a summary card at the top of the chat window
- Summary card has a subtle background, dismiss button, and "Refresh" to regenerate
- Auto-suggest summarization when thread has 15+ messages and support opens it for the first time
- Hidden if partner's `chatSummarization` is disabled

### Test Plan

- [ ] Support can generate a summary for any ticket
- [ ] Summary appears at the top of the chat window
- [ ] Summary refreshes when requested
- [ ] Feature disabled when partner AI config has `chatSummarization: false`
- [ ] Only support/admin can trigger summarization (not agents)
- [ ] Long threads (50+ messages) don't exceed AI token limits (truncate oldest if needed)

---

## Feature 4: AI Translation

**Size**: Small
**Problem**: Agents and support staff may speak different languages (nl/en/fr). Currently they have to manually translate or struggle through messages in unfamiliar languages.

### Backend

**File**: `server/trpc/routers/ai.ts`

1. **New procedure: `ai.translateMessage`**
   - Input: `{ text: string, targetLang: 'nl' | 'en' | 'fr' }`
   - Guard: `protectedProcedure` + check partner AI config (`translation` enabled)
   - Logic:
     ```
     1. Detect source language (or let AI detect)
     2. Call AI provider: "Translate the following to {targetLang}. Preserve tone and meaning."
     3. Return { translated: string, detectedLang: string }
     ```
   - Uses user's `lang` preference as default target language

### Frontend

**File**: `client/src/components/MessageBubble.tsx`

- Add a small "Translate" button on each message bubble (for messages not in the user's language)
- Click → shows translated text below the original (collapsible)
- Auto-detect language mismatch: if message language differs from user's `lang`, show the translate button prominently
- "Translate all" option in chat header to translate the entire thread at once
- Hidden if partner's `translation` is disabled

### Test Plan

- [ ] User can translate individual messages
- [ ] Translation appears below original text
- [ ] User's language preference is used as default target
- [ ] Feature disabled when partner AI config has `translation: false`
- [ ] All three languages supported (nl, en, fr)
- [ ] Already-translated messages show cached result (no re-translation)

---

## Feature 5: AI Sentiment Detection

**Size**: Small
**Problem**: Support managers can't easily spot tickets where agents are frustrated or confused. Issues escalate silently until they become complaints.

### Backend

**File**: `server/trpc/routers/ai.ts` + `server/socket/handlers.ts`

1. **Activate sentiment scoring on message send**
   - When a message is sent, queue a background AI call to score sentiment (-1.0 to 1.0)
   - Store in the existing `sentiment` column on `messages` table
   - Don't block the message send — score asynchronously

2. **New procedure: `ai.getTicketSentiment`**
   - Returns average sentiment for a ticket + trend (improving/worsening)

3. **Update `stats.getStats`** — include sentiment metrics in admin dashboard data

### Frontend

**File**: `client/src/components/admin/AdminStats.tsx` + `client/src/components/support/QueueSidebar.tsx`

- **Admin dashboard**: New "Sentiment" card showing:
  - Average sentiment across open tickets
  - List of tickets with negative sentiment (< -0.3) flagged as "Needs Attention"
  - Sentiment trend over time (chart)
- **Support queue**: Subtle sentiment indicator on ticket rows (e.g., small colored dot)
  - Helps support prioritize which tickets need a more careful response
- Hidden if partner's `sentimentDetection` is disabled

### Test Plan

- [ ] Messages receive sentiment scores after being sent
- [ ] Sentiment scores stored in existing `sentiment` column
- [ ] Admin dashboard shows sentiment metrics
- [ ] Negative sentiment tickets flagged in support queue
- [ ] Feature disabled when partner AI config has `sentimentDetection: false`
- [ ] Sentiment scoring doesn't block message delivery (async)

---

## Feature 6: AI Auto-Summarize on Close

**Size**: Small
**Problem**: When tickets are closed, context is lost — especially before GDPR purge. A summary preserves the gist without retaining PII-laden message text.

### Backend

**File**: `server/trpc/routers/ticket.ts` + `server/trpc/routers/ai.ts`

1. **Hook into ticket close flow**
   - When a ticket is closed/resolved AND partner has `autoSummarizeOnClose` enabled:
     ```
     1. Fetch all messages for the ticket
     2. Call AI: "Summarize this support conversation: the problem, resolution, and any follow-up needed. Keep it to 2-3 sentences."
     3. Store summary in ticket's `closingNotes` field (or new `aiSummary` column)
     ```
   - Fire-and-forget — don't block the close action
   - If AI fails, leave `closingNotes` as-is (graceful degradation)

2. **Feed into archive** — when `archivedTickets` are created during GDPR purge, include the AI summary so archived records have meaningful context even after message text is deleted

### Frontend

**File**: `client/src/components/support/CustomerInfoPanel.tsx` or chat header

- Show AI-generated summary on closed tickets (read-only)
- Support can edit/override the summary before it's finalized
- In archive viewer (`AdminView`), show AI summary alongside archived ticket metadata

### Test Plan

- [ ] Closing a ticket auto-generates a summary when feature is enabled
- [ ] Summary stored in `closingNotes` or dedicated field
- [ ] Summary appears on closed ticket view
- [ ] Support can edit the generated summary
- [ ] Feature disabled when partner AI config has `autoSummarizeOnClose: false`
- [ ] AI failure doesn't prevent ticket from closing
- [ ] Archived tickets include the AI summary

---

## Feature 7: Collision Detection

**Size**: Small
**Problem**: Two support staff members can open the same ticket simultaneously, leading to duplicate or conflicting responses.

### Backend

**File**: `server/socket/handlers.ts`

1. **New socket events**:
   - `ticket:viewing` — emitted when support opens a ticket: `{ ticketId, userId, userName }`
   - `ticket:left` — emitted when support navigates away or disconnects
   - Server tracks active viewers per ticket in memory (Map or Redis hash)

2. **On connect/disconnect cleanup** — remove user from all ticket viewer lists when they disconnect (existing cleanup logic can be extended)

### Frontend

**File**: `client/src/components/ChatWindow.tsx`

- Emit `ticket:viewing` when opening a ticket, `ticket:left` when navigating away
- Listen for other users' `ticket:viewing` / `ticket:left` events
- Show a banner at the top of the chat: "👀 Sarah is also viewing this ticket"
- Multiple viewers: "👀 Sarah and John are also viewing this ticket"
- Banner disappears when other viewers leave
- Subtle, non-intrusive styling (small bar, muted text)

### Test Plan

- [ ] Opening a ticket broadcasts `ticket:viewing` to other support staff
- [ ] Banner shows when another support member is viewing the same ticket
- [ ] Banner updates when additional viewers join/leave
- [ ] Navigating away emits `ticket:left` and removes banner for others
- [ ] Disconnect cleans up viewer state
- [ ] Agents (non-support) don't trigger collision detection

---

## Feature 8: CSAT Improvements

**Size**: Small
**Problem**: Rating system exists but the flow is incomplete — no auto-prompting, no follow-up reminders, and admin reporting is basic.

### Backend

**File**: `server/trpc/routers/rating.ts` + `server/services/mail.ts`

1. **Auto-prompt on close** — when a ticket is closed, set a flag that the agent should be prompted to rate
2. **Follow-up reminder** — if no rating submitted within 24 hours of close, send an email reminder:
   - "How was your support experience for ticket #{id}? Rate it now."
   - Link back to Tessera with the rating modal pre-opened
   - Respect notification preferences (new `ticketRating` preference)
   - Only one reminder per ticket (track `ratingReminderSentAt` on ticket)
3. **Per-support-staff CSAT** — new query: average rating grouped by `supportId`, filterable by date range and department

### Frontend

**File**: `client/src/components/RatingModal.tsx` + `client/src/components/admin/AdminStats.tsx`

1. **Auto-prompt**: When agent's ticket is closed, automatically show the `RatingModal` after a brief delay
2. **Admin dashboard**: New "Team Satisfaction" section:
   - Table: support staff member | avg rating | total ratings | trend
   - Per-department breakdown
   - Time-range filter (week/month/quarter)

### Test Plan

- [ ] Rating modal auto-appears when agent's ticket is closed
- [ ] Agent can dismiss the modal without rating
- [ ] Follow-up email sent after 24h if no rating
- [ ] Only one reminder per ticket
- [ ] Reminder respects notification preferences
- [ ] Admin sees per-support-staff CSAT breakdown
- [ ] CSAT trends display correctly over time

---

## Feature 9: PWA Mobile App

**Size**: Small-Medium
**Problem**: Agents and support staff can only use Tessera from a desktop browser. No mobile access for on-the-go use.

### Phase 1: PWA (Current Sprint)

**Approach**: Make the existing React app installable and mobile-friendly.

#### Frontend Changes

1. **`client/public/manifest.json`** — Web app manifest:
   ```json
   {
     "name": "Tessera Support",
     "short_name": "Tessera",
     "start_url": "/",
     "display": "standalone",
     "background_color": "#ffffff",
     "theme_color": "#000000",
     "icons": [
       { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
       { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
     ]
   }
   ```

2. **Service Worker** — `client/public/sw.js`:
   - Cache static assets (app shell) for offline loading
   - Network-first strategy for API calls
   - Background sync for messages sent while offline (queue and retry)

3. **Responsive CSS** — key views must work on mobile:
   - `AgentView`: Stack sidebar below main content, collapsible ticket list
   - `SupportView`: Ticket list as full-screen, tap to open chat (no side-by-side on mobile)
   - `AdminView`: Sidebar becomes hamburger menu
   - Touch-friendly tap targets (min 44px)
   - Hide non-essential elements on small screens

4. **Push Notifications** — via Web Push API:
   - New ticket assigned to support
   - Agent receives reply on their ticket
   - Reuse existing notification permission flow

### Phase 2: Native App (Future — Only If Needed)

- React Native / Expo
- Evaluate based on PWA adoption metrics and user feedback
- Decision point: revisit after 3 months of PWA usage data

### Test Plan

- [ ] App is installable on Android (Chrome "Add to Home Screen")
- [ ] App is installable on iOS (Safari "Add to Home Screen")
- [ ] All views render correctly on mobile screen sizes (375px - 428px width)
- [ ] Touch targets are accessible (min 44px)
- [ ] Push notifications work on Android
- [ ] Offline: app shell loads without network
- [ ] Chat works smoothly on mobile (keyboard doesn't obscure input)
- [ ] Dark mode works correctly in standalone PWA mode

---

## Feature 10: SLA Improvements

**Size**: Medium
**Problem**: SLA is currently a single global `SLA_THRESHOLD_MS` env var (default 3 minutes). No per-tenant or per-department configuration, no visibility for support staff, and the metric only tracks first response time.

### Backend

#### Database

**Migration**: Add SLA configuration per partner.

Option: JSONB column on `partners` table:
```typescript
interface SlaConfig {
  defaultResponseMs: number;     // default first response time target
  defaultResolutionMs: number;   // default resolution time target
  byDepartment?: Record<string, {
    responseMs: number;
    resolutionMs: number;
  }>;
  businessHoursOnly: boolean;    // pause SLA clock outside business hours
}
```

Add to tickets: `slaResponseDueAt` and `slaResolutionDueAt` timestamps (calculated on ticket creation based on partner SLA config + business hours).

#### tRPC Changes

**File**: `server/trpc/routers/partner.ts`

1. **`partner.updateSlaConfig`** — admin procedure to set SLA targets per department
   - Input: `SlaConfig` object
   - Validates thresholds are positive integers
   - Audit log: `'partner.sla_updated'`

2. **`partner.getSlaConfig`** — returns current SLA config for the partner

**File**: `server/trpc/routers/ticket.ts`

3. **On ticket creation** — calculate `slaResponseDueAt` and `slaResolutionDueAt` based on:
   - Partner's SLA config (department-specific if configured, else default)
   - Business hours (if `businessHoursOnly: true`, skip non-business hours in calculation)

**File**: `server/services/stats.ts`

4. **Update SLA compliance calculation** — use per-partner thresholds instead of global `SLA_THRESHOLD_MS`
5. **Track both response AND resolution SLA** separately

#### Breach Alerts

**File**: `server/services/slaMonitor.ts` (new)

- Periodic check (every minute via setInterval or cron):
  - Find tickets where `slaResponseDueAt` or `slaResolutionDueAt` is approaching (< 15 min) or breached
  - Emit socket event: `sla:warning` or `sla:breach`
  - Optionally send email to team lead / admin on breach

### Frontend

**File**: `client/src/components/admin/AdminSla.tsx` (new)

- New section in AdminView sidebar: "SLA Policies"
- Configure default response/resolution targets
- Override per department
- Toggle business-hours-only mode

**File**: `client/src/components/support/QueueSidebar.tsx`

- Show SLA countdown on each ticket in the queue:
  - Green: > 50% time remaining
  - Yellow: < 50% time remaining
  - Red: SLA breached
- Sort option: "Most urgent (SLA)" to surface at-risk tickets

**File**: `client/src/components/ChatWindow.tsx`

- SLA timer in the chat header for the active ticket
- Shows "Respond within: 45 min" or "⚠️ SLA breached 2h ago"

**File**: `client/src/components/admin/AdminStats.tsx`

- Update SLA Health card to show response vs resolution compliance separately
- Per-department SLA compliance breakdown

### Migration Path

- Keep `SLA_THRESHOLD_MS` as fallback for partners without configured SLA
- Existing `dailyStats` records remain valid (historical data preserved)
- New SLA calculations apply to tickets created after migration

### Test Plan

- [ ] Admin can configure SLA targets per partner
- [ ] Admin can override SLA targets per department
- [ ] New tickets get `slaResponseDueAt` calculated correctly
- [ ] Business hours mode pauses SLA clock outside hours
- [ ] Support queue shows SLA countdown per ticket
- [ ] SLA breach triggers socket notification
- [ ] SLA compliance stats use per-partner thresholds
- [ ] Partners without SLA config fall back to global `SLA_THRESHOLD_MS`
- [ ] Stats show response and resolution SLA separately

---

## Feature 11: Flexible Auth — SSO + Local Per User

**Size**: Small
**Problem**: Currently `authMethod` is per partner — ALL users of a partner must use either local or SSO. In practice, your company runs one Azure AD tenant. Internal staff (support/admin) log in via SSO. External agents are invited by admins and may use local login (temp password) or SSO (if added as guest users in your Azure AD). The system should let both auth methods coexist per partner.

### What exists today

- `partners.authMethod` = `'local'` or `'sso'` — forces all users of a partner to one method
- `sso.ts` — single-tenant Azure AD SSO (your company's tenant via env vars) — works
- `partner.inviteExternalUser` — creates user with temp password if partner is `local`, no password if `sso`
- Login page — shows email/password OR SSO button, not both

### Backend

#### Database

**Migration**: `server/drizzle/0013_flexible_auth.sql`

```sql
-- Add per-user auth preference (nullable = use partner default)
ALTER TABLE users ADD COLUMN auth_method text;  -- 'local' | 'sso' | NULL

-- Change partner auth_method to allow 'both'
-- (existing 'local' and 'sso' values still work)
```

No new tables needed. No encryption changes. The existing single-tenant SSO config via env vars stays as-is.

#### Invite Flow Changes

**File**: `server/trpc/routers/partner.ts` — update `inviteExternalUser`

Add `authMethod` to input: `z.enum(['local', 'sso']).optional().default('local')`

- `authMethod: 'local'` → generate temp password, send in welcome email (current behavior)
- `authMethod: 'sso'` → no password, welcome email says "Sign in with Microsoft"
- Store choice on `users.auth_method`

**File**: `server/trpc/routers/platform.ts` — update `inviteUser`

Same change — add optional `authMethod` to input.

#### Login Changes

**File**: `server/routes/auth.ts`

- `POST /login-local` — no changes needed, already checks password exists
- Allow local login even if partner is `sso`, as long as user has a password set

**File**: `server/routes/sso.ts`

- Allow SSO login even if partner is `local`, as long as user's `auth_method` is `sso` or user has `external_id`
- On SSO callback: match user by `external_id` (Azure OID) or email. If matched and user belongs to the partner, log them in regardless of partner `authMethod`

#### Partner Config

**File**: `server/trpc/routers/partner.ts` or `platform.ts`

- Allow setting `partners.authMethod` to `'both'` — enables both login options for the partner
- Default new partners to `'both'`

### Frontend

#### Login Page

**File**: `client/src/components/LoginView.tsx`

Show both login options when partner allows it:

```
┌─────────────────────────────────┐
│                                  │
│  Email:    [ jan@acme.com    ]   │
│  Password: [ ••••••••••     ]    │
│  [Sign in]                       │
│                                  │
│  ─── or ───                      │
│                                  │
│  [Sign in with Microsoft]        │
│                                  │
└─────────────────────────────────┘
```

- If partner `authMethod` = `'local'`: hide Microsoft button
- If partner `authMethod` = `'sso'`: hide password field
- If partner `authMethod` = `'both'`: show both

#### Invite Modal

**File**: `client/src/components/admin/UserTable.tsx` (or invite modal)

Add auth method selector when inviting:

```
Auth method:  ○ Local (email + password)
              ○ SSO (Sign in with Microsoft)
```

- Local selected → admin sees temp password after invite
- SSO selected → no password, user must use Microsoft login

### Test Plan

- [ ] Admin can invite user with `authMethod: 'local'` → gets temp password
- [ ] Admin can invite user with `authMethod: 'sso'` → no password, must use SSO
- [ ] Login page shows both options when partner `authMethod` is `'both'`
- [ ] SSO user can log in even if partner was previously `local`-only
- [ ] Local user can log in even if partner was previously `sso`-only
- [ ] Existing users and invites unaffected (backward compatible)
- [ ] User with no password cannot use local login (redirected to SSO)
- [ ] User with password can always use local login as fallback

---

## Sprint Plan

### Sprint 1 — AI Foundation + Core AI Features (~3 weeks)
_Lays the AI groundwork, then delivers the most user-visible AI features._

```
 0. AI Provider Abstraction Layer   ✅ DONE  ← prerequisite for all AI features
 1. Per-Tenant AI Configuration     ✅ DONE  ← gates which tenants get AI
 2. AI Message Improvement          ✅ DONE  ← highest agent/support value
 3. AI Chat Summarization           ✅ DONE  ← natural companion to #2
```

**E2E scope**: Auth fixtures, AI mock layer, tests for features 0–3
**Deliverable**: Agents can improve messages, support can summarize chats

---

### Sprint 2 — AI Completion + Real-Time UX (~2.5 weeks)
_Finishes remaining AI features, adds collision detection._

```
 4. AI Translation                  ✅ DONE  ← merged into Sprint 1 (auto-translate in chat)
 5. AI Sentiment Detection          ✅ DONE  ← background/async AI
 6. AI Auto-Summarize on Close      ✅ DONE  ← hooks into ticket lifecycle
 7. Collision Detection             ✅ DONE  ← socket.io real-time feature
```

**E2E scope**: Socket.io test helpers, multi-browser collision tests, sentiment/translation UI
**Deliverable**: Full AI suite live, real-time collaboration awareness

---

### Sprint 3 — Platform Hardening (~2.5 weeks)
_Operational improvements: SLA, CSAT, auth flexibility._

```
 8. CSAT Improvements               ✅ DONE  ← extends existing rating system
10. SLA Improvements                ✅ DONE  ← per-tenant SLA, breach alerts
11. Flexible Auth — SSO + Local     ✅ DONE  ← can be built in parallel
```

**E2E scope**: SLA timer assertions, CSAT auto-prompt flow, dual-auth login tests
**Deliverable**: Configurable SLA, better CSAT reporting, mixed auth support

---

### Sprint 4 — Mobile & Polish (~2 weeks)
_PWA rollout after all features are stable._

```
 9. PWA Mobile App                  ✅ DONE  ← all features must work on mobile
```

**E2E scope**: Mobile viewport tests, service worker, push notifications, offline
**Deliverable**: Installable mobile app covering all existing features

---

### Time Summary

| Sprint | Features | Impl | E2E Tests | Total |
|--------|----------|------|-----------|-------|
| **1 — AI Foundation** | 0, 1, 2, 3 | ~8–12 days | ~4–5 days | **~2.5–3.5 weeks** |
| **2 — AI + Real-Time** | 4, 5, 6, 7 | ~7–11 days | ~4–6 days | **~2–3.5 weeks** |
| **3 — Platform Hardening** | 8, 10, 11 | ~7–10 days | ~4–5 days | **~2–3 weeks** |
| **4 — Mobile** | 9 | ~3–4 days | ~2–3 days | **~1–1.5 weeks** |
| | | | | **~8–11.5 weeks total** |
