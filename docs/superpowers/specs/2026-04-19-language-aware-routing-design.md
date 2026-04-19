# Language-Aware Queue Routing — Design Spec

**Date:** 2026-04-19
**Scope:** Surface language-staffing imbalance in the support queue and remove friction from cross-language pickup. Translation already handles the wire-level conversation; the gap is UX/visibility.
**Status:** Draft — awaiting approval before implementation.

## Problem

Partner has many fr support staff, very few nl support staff. nl agent tickets sit in the queue while fr support — who *could* take them via the auto-translation pipeline — don't grab them. Reasons observed:

- Fr support don't see/realize cross-lang pickup is supported
- No visibility into the staffing imbalance ("are there nl support online or not?")
- The friction of "I'd have to mentally translate" deters them, even though AI does it automatically

Ticket queue today is sorted by age only ([ticket.ts:132](server/socket/handlers/ticket.ts:132) creates with `supportId: null`, support claims via UI). No language signal in the UI, no staffing widget.

## Non-Goals

- **Push-based assignment.** Server does not auto-assign. Pull-based stays. (See "Why not push-assign" at the bottom.)
- **Hard language gating.** No "you can only see fr tickets" filter. The whole point is to break down the silo.
- **Per-support language proficiency tracking.** Treats `users.lang` as the single signal. Skill-level weighting (`langProficiency: { fr: 'native', nl: 'b2' }`) is a v2 feature.
- **Multi-language tickets.** A ticket has one `agentLang` (set at creation). Customer/agent code-switching mid-conversation is out of scope; the auto-translate pipeline best-efforts it already.
- **Customer-language separate from agent-language.** The ticket's `agentLang` is the language to optimize for. Tracking a separate `customerLang` is a bigger refactor and not needed for this fix.

## Solution

Three additive UI changes + one auto-config change. No schema changes.

1. Queue sorted by age (already true) + visible **language badge** per ticket
2. **Staffing summary header** at top of QueueSidebar: per-language counts of online support vs unclaimed tickets, with imbalance call-out
3. **Cross-lang banner** in ChatHeader when support's `users.lang ≠ ticket.agentLang`: reassures "AI translates your replies"
4. **Auto-force translation** for cross-lang tickets at the message-send layer (no opt-in click needed once inside a cross-lang ticket)

## Scope Decisions

| decision | choice | rationale |
|---|---|---|
| sort order | age only (oldest first) | language sort would push nl tickets to the bottom for fr support → silo. age = fairness. |
| visibility | language badge always shown | invisible language = invisible imbalance |
| friction-removal | banner + auto-force translation | answers the unstated objection ("but I'd have to translate") |
| gating | per-partner toggle `aiFeatures.queueLangAwareness` (boolean) | mono-lingual partners don't need the noise; lives in existing JSONB next to `voiceInput`/`translation` |
| presence source | existing `presence.ts` Redis-backed online tracking | no new presence infra |

## Data Model

**No schema changes.** Reuses:

- `users.lang` (already used for translation routing)
- `tickets.agentLang` (already set at creation, [ticket.ts:132](server/socket/handlers/ticket.ts:132))
- `presence` Redis store (existing online/offline tracking via `services/presence.ts`)
- `memberships` (to scope counts to partner)

One new optional partner setting, stored inside the existing `partners.aiFeatures` JSONB:

```ts
// partners.aiFeatures.queueLangAwareness?: boolean   // default undefined → false
```

Lives next to `voiceInput`, `translation`, `messageImprovement`. No migration required (JSONB accepts the new key). Platform operator toggles via the existing `BOOLEAN_FEATURES` array in `EditPartnerModal`. Why JSONB and not a dedicated column: we never query `WHERE queueLangAwareness=true` and the value travels with the rest of `aiFeatures` already.

## tRPC Endpoint — `support.getStaffingByLanguage`

```ts
input: { partnerId: string }

output: Array<{
  lang: 'nl' | 'fr' | 'en';                // language code
  onlineSupport: number;                   // online + role in {support, admin, platform_operator}
  unclaimedTickets: number;                // status='open', supportId=null, agentLang=lang
  averageWaitMinutes: number | null;       // age of oldest unclaimed ticket; null if none waiting
  imbalanceLevel: 'ok' | 'thin' | 'critical';
}>
```

**Imbalance heuristic:**
- `ok` — at least 1 online support per 5 unclaimed tickets
- `thin` — 0 online support but ≤ 2 tickets waiting, OR 1+ online support per 10+ tickets
- `critical` — 0 online support AND ≥ 3 tickets waiting (or oldest > 5 min)

Polled every 30s from `QueueSidebar`. No socket push for v1 — too noisy for a header widget. Re-fetch on `presence:change` socket event (already broadcast on online/offline transitions).

## UI Changes

### `QueueSidebar` — staffing header (new)

At the top of the sidebar, above the ticket list:

```
STAFFING           NL ⚠️         FR           EN
                   0 online     8 online     2 online
                   3 waiting    1 waiting    0 waiting
                   oldest 6m    oldest 1m    —
```

- Critical-level languages render with the warning glyph + amber/red tokenized color (uses existing `accent-amber` / `accent-red`)
- Hover: tooltip explains the count source ("Online support staff with NL set as primary language")
- Click on a language column: filters the ticket list below to that language only (toggleable)
- Hidden entirely when `aiFeatures.queueLangAwareness === false`

### `QueueSidebar` — ticket row badge

Each ticket row shows a small lang badge (`NL`, `FR`, `EN`) next to the ticket title. Color-tokenized:
- support's own language → muted (no special treatment)
- other language → uses `accent-blue` to draw the eye

The badge is purely informational; it does not change row order or grouping.

### `ChatHeader` — cross-lang banner (new)

When the active ticket's `agentLang` differs from the current support user's `users.lang`, render a single-line banner under the ticket title:

> *Replies are auto-translated to NL for the agent.*

Banner uses the existing brutalist info-banner pattern (border-bottom, no decorative icon, JetBrains Mono). Dismissible per-session via × in the corner; reappears on next page load.

i18n strings (extending existing bundle):

| key | nl | fr | en |
|---|---|---|---|
| `queue.staffing.heading` | "Bezetting per taal" | "Personnel par langue" | "Staffing by language" |
| `queue.staffing.online` | "{n} online" | "{n} en ligne" | "{n} online" |
| `queue.staffing.waiting` | "{n} wachtend" | "{n} en attente" | "{n} waiting" |
| `queue.staffing.oldest` | "oudste {duration}" | "le plus ancien : {duration}" | "oldest {duration}" |
| `chat.crossLang.banner` | "Antwoorden worden automatisch vertaald naar {lang} voor de agent." | "Vos réponses sont traduites automatiquement en {lang} pour l'agent." | "Replies are auto-translated to {lang} for the agent." |

## Server-Side Auto-Force Translation

When a support user sends a message in a ticket where `support.lang ≠ ticket.agentLang` AND partner has `aiFeatures.translation === true` AND `aiFeatures.queueLangAwareness === true`:

- The translation is already triggered by the per-viewer pipeline at render time. **No new translation step needed at send time.**
- BUT: pre-translate-and-cache eagerly so the agent doesn't see the raw fr text for ~300ms before the JS-side translation hydrates. Do this by calling translate inline after `insertMessage` and warming the `(messageId, targetLang)` cache before `socket.emit('message:new')`.

This change lives in `server/socket/handlers/message.ts` post-insert hook, gated on `aiFeatures.queueLangAwareness`.

## Audit Logging

- No new audit actions. The existing `message.created` / `message.translated` events cover this.
- Partner toggle change (`partner.queueLangAwarenessUpdated`) goes through existing `audit_log`.

## Metrics

- `guichet_queue_unclaimed_by_lang{partnerId,lang}` gauge — current count
- `guichet_queue_oldest_unclaimed_seconds{partnerId,lang}` gauge — age of oldest waiting ticket
- `guichet_queue_staffing_imbalance{partnerId,lang}` gauge — 0=ok, 1=thin, 2=critical (for alert rules)
- `guichet_cross_lang_pickup_total{partnerId,supportLang,ticketLang}` counter — how often fr support take nl tickets (success metric)

### Alert rule

- `QueueLangCritical` — `imbalance == 'critical'` for any (partner, lang) for 10m

## Test Strategy

### Unit (`server/trpc/routers/support.test.ts`)

- `getStaffingByLanguage` returns correct counts for online/offline support
- Imbalance heuristic boundaries (5:1, 10:1, ≥3 waiting with 0 online)
- Multi-tenancy: partner A's staffing query never sees partner B's data
- Returns 0-row array when `queueLangAwareness === false` (or skip endpoint entirely; client guard preferred)

### Unit (`server/socket/handlers/message.test.ts`)

- Cross-lang ticket: support sends fr message → translate-cache warm before broadcast
- Same-lang ticket: no translate call
- Toggle off: no translate call even cross-lang

### E2E (Playwright)

- Login as fr support, partner has 1 unclaimed nl ticket → staffing header shows NL critical
- Click NL column → queue filters to NL only
- Open the nl ticket → cross-lang banner appears
- Send a reply → nl agent (separate browser context) receives nl-translated message in ≤ 1s
- Toggle `queueLangAwareness` off in EditPartnerModal → header disappears, banner disappears

## Rollout

1. Extend `aiFeatures` Zod validator to accept `queueLangAwareness?: boolean`. No migration needed (JSONB accepts new keys; `undefined` is treated as `false` everywhere).
2. Ship `getStaffingByLanguage` tRPC endpoint behind no flag (cheap query, no harm).
3. Ship `QueueSidebar` staffing header + lang badges, gated on `queueLangAwareness`.
4. Ship `ChatHeader` cross-lang banner + i18n.
5. Ship server-side translate-cache pre-warm in message-send handler.
6. Wire metrics + Grafana panel + `QueueLangCritical` alert.
7. Enable `queueLangAwareness=true` for the bilingual partner that prompted this spec.
8. Default off for new partners; admins opt in.

## Follow-Ups (Out of Scope for v1)

- Per-support `langProficiency` skill matrix (`{ nl: 'native', fr: 'b2' }`) for soft routing tiebreaks
- Customer-language tracking separate from agent-language (`tickets.customer_lang`)
- Push-based auto-assignment with capacity-aware routing
- Slack/email digest to admins when imbalance is `critical` for >30m
- "Nudge" notification: ping fr support when nl queue has been thin for 10m (annoying without thresholds; needs research)
- Predictive staffing: train a model on weekly traffic patterns, suggest hours to schedule more nl support

## Why Not Push-Assign (for the record)

The user previously asked about same-language priority routing; this spec is the opposite direction. Push-assignment would be a separate, larger effort with these complications:
- Different product model (call-center vs live-chat)
- Conflicts with existing collision-detection / multi-tab claim UX
- Edge cases: agent away mid-assign, agent refuses, lone fr-speaker burnout, multi-dept fit
- Customer-perceived latency unchanged (queue is already real-time)
- Pull-based + good UX usually beats push-based + bad UX for live chat

Revisit only if option 1 + this spec proves insufficient.

## Open Questions

- [x] ~~Should the staffing header be visible to all roles or support-only?~~ **Resolved 2026-04-20:** support + admin. Admin-only would kill the cross-lang pickup nudge which is the feature's whole point. Shipped in `1535f06` (M-1 review fix).
- [x] ~~Banner dismissal — per-session (current proposal) vs per-ticket vs never-dismissible?~~ **Resolved 2026-04-20:** self-dismiss after the current support's first non-whisper reply. No user action required, no local state to persist, derives from message history. Shipped in `01cfbc3`.
- [ ] Integration with the language-aware AI instructions spec ([2026-04-19-partner-ai-instructions-design.md](docs/superpowers/specs/2026-04-19-partner-ai-instructions-design.md)) — when fr support replies in a nl ticket, partner's "house style" instructions should govern the translation, not just literal translation.
