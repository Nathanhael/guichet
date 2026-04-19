# Language-Aware Queue Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-language staffing imbalance in the support queue and remove friction from cross-language pickup, so the large fr pool can absorb the thin nl queue without friction.

**Architecture:** Additive — no schema changes. Reuses existing `users.lang`, `tickets.agentLang`, Redis presence, per-viewer `trpc.ai.translateMessage` pipeline. Adds one new tRPC router (`support`), one feature flag in existing `partners.aiFeatures` JSONB (`queueLangAwareness`), two new UI widgets (QueueSidebar staffing header + ChatHeader cross-lang banner), one per-row badge, and a server-side pre-warm of translations in the `message:new` broadcast payload so cross-lang viewers don't see a ~300ms flash of the raw text.

**Tech Stack:** tRPC 11 + Zod, drizzle-orm (Postgres), Socket.io + Redis, React 19, Tailwind 4, Vitest, Playwright, prom-client, Prometheus/Alertmanager.

**Spec:** [docs/superpowers/specs/2026-04-19-language-aware-routing-design.md](docs/superpowers/specs/2026-04-19-language-aware-routing-design.md)

---

## File Structure

**New files:**
- `server/trpc/routers/support.ts` — new router; `getStaffingByLanguage` endpoint + imbalance heuristic helper
- `server/trpc/routers/support.test.ts` — unit tests (heuristic, multi-tenancy, gate)
- `client/src/components/support/StaffingHeader.tsx` — header widget (polled staffing card)
- `client/src/components/support/LangBadge.tsx` — 3-letter language chip used by QueueTicketRow + ChatHeader
- `testing/e2e/queue-lang-awareness.spec.ts` — Playwright E2E

**Modified files:**
- `server/trpc/routers/platform/partners.ts` — extend `aiFeatures` Zod with `queueLangAwareness`
- `server/trpc/router.ts` — register `support` router
- `server/socket/handlers/message.ts` — pre-warm translations in `message:new` broadcast
- `server/utils/messageMapper.ts` — expose `translations` field in mapped row
- `server/utils/metrics.ts` — 3 new gauges + 1 new counter
- `monitoring/alerts.yml` — `QueueLangCritical` alert rule
- `client/src/components/platform/types.ts` — `AiFeatures.queueLangAwareness`
- `client/src/components/platform/EditPartnerModal.tsx` — add to `BOOLEAN_FEATURES`
- `client/src/components/support/QueueSidebar.tsx` — render StaffingHeader, pass filter state down
- `client/src/components/support/QueueTicketRow.tsx` — render lang badge
- `client/src/components/chat/ChatHeader.tsx` — cross-lang banner
- `client/src/hooks/useTranslation.ts` — consume pre-warmed `translations[lang]` from message payload before firing the tRPC call
- `client/src/types/index.ts` — add `translations?: Record<string, string>` to `Message`
- `client/src/locales/en.ts` / `nl.ts` / `fr.ts` — 5 i18n keys

---

## Task 1: Feature flag plumbing (`queueLangAwareness`)

**Files:**
- Modify: `server/trpc/routers/platform/partners.ts:105-110` (aiFeatures Zod block)
- Modify: `client/src/components/platform/types.ts:13-18` (`AiFeatures` interface)
- Modify: `client/src/components/platform/EditPartnerModal.tsx:12-16` (`BOOLEAN_FEATURES` array)
- Test: `server/trpc/routers/platform.lifecycle.audit.test.ts` (existing — extend with one assertion)

- [ ] **Step 1: Extend the AiFeatures Zod schema**

Edit `server/trpc/routers/platform/partners.ts`, lines 105-110. Replace:

```ts
aiFeatures: z.object({
  messageImprovement: z.enum(['off', 'optional', 'forced']).optional(),
  chatSummarization: z.boolean().optional(),
  translation: z.boolean().optional(),
  autoSummarizeOnClose: z.boolean().optional(),
}).optional(),
```

with:

```ts
aiFeatures: z.object({
  messageImprovement: z.enum(['off', 'optional', 'forced']).optional(),
  chatSummarization: z.boolean().optional(),
  translation: z.boolean().optional(),
  autoSummarizeOnClose: z.boolean().optional(),
  queueLangAwareness: z.boolean().optional(),
}).optional(),
```

- [ ] **Step 2: Extend the client AiFeatures interface**

Edit `client/src/components/platform/types.ts`, lines 13-18. Add the new field:

```ts
export interface AiFeatures {
  messageImprovement?: ImprovementMode;
  chatSummarization?: boolean;
  translation?: boolean;
  autoSummarizeOnClose?: boolean;
  queueLangAwareness?: boolean;
}
```

- [ ] **Step 3: Wire the toggle into EditPartnerModal**

Edit `client/src/components/platform/EditPartnerModal.tsx`, lines 12-16. Extend `BOOLEAN_FEATURES`:

```ts
const BOOLEAN_FEATURES: { key: Exclude<keyof AiFeatures, 'messageImprovement'>; label: string; description: string }[] = [
  { key: 'chatSummarization', label: 'Chat Summarization', description: 'Generate summaries of support conversations' },
  { key: 'translation', label: 'Auto-Translation', description: 'Automatically translate messages between nl/en/fr based on user language' },
  { key: 'autoSummarizeOnClose', label: 'Auto-Summarize on Close', description: 'Generate summary when ticket is closed' },
  { key: 'queueLangAwareness', label: 'Queue Language Awareness', description: 'Show per-language staffing header + cross-lang banner; pre-warm translations for cross-lang tickets' },
];
```

- [ ] **Step 4: Typecheck**

```bash
docker compose exec server npx tsc --noEmit
docker compose exec client npx tsc --noEmit
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/platform/partners.ts client/src/components/platform/types.ts client/src/components/platform/EditPartnerModal.tsx
git commit -m "feat(routing): add queueLangAwareness feature flag to aiFeatures"
```

---

## Task 2: i18n keys for staffing header + cross-lang banner

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/nl.ts`
- Modify: `client/src/locales/fr.ts`

Add 5 keys per locale: `queue.staffing.heading`, `queue.staffing.online`, `queue.staffing.waiting`, `queue.staffing.oldest`, `chat.crossLang.banner`.

**Key naming note:** locales in this codebase use flat keys (e.g. `queue_empty`, not `queue.empty`). We'll follow that convention: `queue_staffing_heading`, `queue_staffing_online`, `queue_staffing_waiting`, `queue_staffing_oldest`, `chat_cross_lang_banner`.

- [ ] **Step 1: Add English keys**

Append to `client/src/locales/en.ts` (before the closing `};` of the `const en` object):

```ts
    // Language-aware queue routing
    queue_staffing_heading: 'Staffing by language',
    queue_staffing_online: '{n} online',
    queue_staffing_waiting: '{n} waiting',
    queue_staffing_oldest: 'oldest {duration}',
    chat_cross_lang_banner: 'Replies are auto-translated to {lang} for the agent.',
```

- [ ] **Step 2: Add Dutch keys**

Append to `client/src/locales/nl.ts`:

```ts
    // Taalbewuste wachtrij
    queue_staffing_heading: 'Bezetting per taal',
    queue_staffing_online: '{n} online',
    queue_staffing_waiting: '{n} wachtend',
    queue_staffing_oldest: 'oudste {duration}',
    chat_cross_lang_banner: 'Antwoorden worden automatisch vertaald naar {lang} voor de klant.',
```

- [ ] **Step 3: Add French keys**

Append to `client/src/locales/fr.ts`:

```ts
    // File d'attente multilingue
    queue_staffing_heading: 'Personnel par langue',
    queue_staffing_online: '{n} en ligne',
    queue_staffing_waiting: '{n} en attente',
    queue_staffing_oldest: 'le plus ancien : {duration}',
    chat_cross_lang_banner: 'Vos réponses sont traduites automatiquement en {lang} pour le client.',
```

- [ ] **Step 4: Typecheck (locales are typed as `Record<string, string>`)**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/nl.ts client/src/locales/fr.ts
git commit -m "feat(routing): add i18n keys for staffing header and cross-lang banner"
```

---

## Task 3: Imbalance heuristic — pure function + unit tests

The heuristic is a pure `(onlineSupport, unclaimedTickets, oldestWaitMinutes) -> 'ok' | 'thin' | 'critical'`. Implement and test in isolation before wiring into a tRPC router.

**Files:**
- Create: `server/trpc/routers/support.ts` (skeleton with only the helper exported)
- Create: `server/trpc/routers/support.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/trpc/routers/support.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyImbalance } from './support.js';

describe('classifyImbalance', () => {
  it('returns ok when support/ticket ratio is at least 1:5', () => {
    expect(classifyImbalance({ online: 2, waiting: 10, oldestWaitMinutes: 3 })).toBe('ok');
    expect(classifyImbalance({ online: 1, waiting: 5, oldestWaitMinutes: 1 })).toBe('ok');
    expect(classifyImbalance({ online: 5, waiting: 0, oldestWaitMinutes: 0 })).toBe('ok');
  });

  it('returns critical when zero support and >=3 tickets waiting', () => {
    expect(classifyImbalance({ online: 0, waiting: 3, oldestWaitMinutes: 0 })).toBe('critical');
    expect(classifyImbalance({ online: 0, waiting: 20, oldestWaitMinutes: 12 })).toBe('critical');
  });

  it('returns critical when zero support and oldest > 5 minutes even with <3 waiting', () => {
    expect(classifyImbalance({ online: 0, waiting: 1, oldestWaitMinutes: 6 })).toBe('critical');
  });

  it('returns thin when zero support but <=2 waiting and oldest <=5 min', () => {
    expect(classifyImbalance({ online: 0, waiting: 2, oldestWaitMinutes: 4 })).toBe('thin');
    expect(classifyImbalance({ online: 0, waiting: 1, oldestWaitMinutes: 0 })).toBe('thin');
  });

  it('returns thin when support is severely outnumbered (>=1:10 ratio)', () => {
    expect(classifyImbalance({ online: 1, waiting: 10, oldestWaitMinutes: 2 })).toBe('thin');
    expect(classifyImbalance({ online: 2, waiting: 25, oldestWaitMinutes: 2 })).toBe('thin');
  });

  it('treats zero waiting as ok regardless of staffing', () => {
    expect(classifyImbalance({ online: 0, waiting: 0, oldestWaitMinutes: 0 })).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
docker compose exec server npx vitest run trpc/routers/support.test.ts
```

Expected: FAIL with `Cannot find module './support.js'`.

- [ ] **Step 3: Create the skeleton support router with the helper**

Create `server/trpc/routers/support.ts`:

```ts
import { router } from '../trpc.js';

export interface ImbalanceInput {
  online: number;
  waiting: number;
  oldestWaitMinutes: number;
}

export type ImbalanceLevel = 'ok' | 'thin' | 'critical';

/**
 * Heuristic from the routing spec. Critical = zero staffing AND (>=3 waiting
 * OR oldest wait exceeds 5 minutes). Thin = severely outnumbered (>=1:10) OR
 * zero staffing with a light queue still in the green window. Otherwise ok.
 */
export function classifyImbalance(input: ImbalanceInput): ImbalanceLevel {
  const { online, waiting, oldestWaitMinutes } = input;
  if (waiting === 0) return 'ok';
  if (online === 0) {
    if (waiting >= 3 || oldestWaitMinutes > 5) return 'critical';
    return 'thin';
  }
  const ratio = waiting / online;
  if (ratio >= 10) return 'thin';
  if (ratio <= 5) return 'ok';
  return 'ok';
}

export const supportRouter = router({});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
docker compose exec server npx vitest run trpc/routers/support.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/support.ts server/trpc/routers/support.test.ts
git commit -m "feat(routing): add imbalance classifier for per-language staffing"
```

---

## Task 4: `support.getStaffingByLanguage` tRPC endpoint

**Files:**
- Modify: `server/trpc/routers/support.ts`
- Modify: `server/trpc/routers/support.test.ts`
- Modify: `server/trpc/router.ts` (register `support` router)

- [ ] **Step 1: Write the failing integration test**

Append to `server/trpc/routers/support.test.ts`:

```ts
import { appRouter } from '../router.js';
import { db } from '../../db.js';
import { partners, users, memberships, tickets } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// Test callers use the createCaller({user}) pattern directly, matching
// server/trpc/routers/platform.lifecycle.audit.test.ts:74 — there is no
// createContextInner helper in this codebase.
type CallerCtx = Parameters<typeof appRouter.createCaller>[0];

describe('support.getStaffingByLanguage', () => {
  const partnerA = 'test-support-staffing-a';
  const partnerB = 'test-support-staffing-b';
  const userNlId = randomUUID();
  const userFrId = randomUUID();

  beforeAll(async () => {
    await db.insert(partners).values({
      id: partnerA,
      name: 'Partner A',
      industry: 'Test',
      departments: [{ id: 'support', name: 'Support' }],
      status: 'active',
      aiFeatures: { queueLangAwareness: true, translation: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await db.insert(partners).values({
      id: partnerB,
      name: 'Partner B',
      industry: 'Test',
      departments: [{ id: 'support', name: 'Support' }],
      status: 'active',
      aiFeatures: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await db.insert(users).values([
      { id: userNlId, name: 'Nl User', email: 'nl@test', lang: 'nl' },
      { id: userFrId, name: 'Fr User', email: 'fr@test', lang: 'fr' },
    ]);
    await db.insert(memberships).values([
      { id: randomUUID(), userId: userNlId, partnerId: partnerA, role: 'support', departments: [] },
      { id: randomUUID(), userId: userFrId, partnerId: partnerA, role: 'support', departments: [] },
    ]);
    // 3 unclaimed nl tickets, 1 unclaimed fr ticket on partner A
    const now = new Date();
    const ago10 = new Date(now.getTime() - 10 * 60_000).toISOString();
    const ago1 = new Date(now.getTime() - 60_000).toISOString();
    await db.insert(tickets).values([
      { id: randomUUID(), partnerId: partnerA, agentId: randomUUID(), agentName: 'A1', agentLang: 'nl', dept: 'support', status: 'open', supportId: null, createdAt: ago10, updatedAt: ago10, participants: [] },
      { id: randomUUID(), partnerId: partnerA, agentId: randomUUID(), agentName: 'A2', agentLang: 'nl', dept: 'support', status: 'open', supportId: null, createdAt: ago1, updatedAt: ago1, participants: [] },
      { id: randomUUID(), partnerId: partnerA, agentId: randomUUID(), agentName: 'A3', agentLang: 'nl', dept: 'support', status: 'open', supportId: null, createdAt: ago1, updatedAt: ago1, participants: [] },
      { id: randomUUID(), partnerId: partnerA, agentId: randomUUID(), agentName: 'A4', agentLang: 'fr', dept: 'support', status: 'open', supportId: null, createdAt: ago1, updatedAt: ago1, participants: [] },
      // partner B has its own ticket that must NOT leak into partner A's count
      { id: randomUUID(), partnerId: partnerB, agentId: randomUUID(), agentName: 'B1', agentLang: 'nl', dept: 'support', status: 'open', supportId: null, createdAt: ago1, updatedAt: ago1, participants: [] },
    ]);
  });

  afterAll(async () => {
    await db.delete(tickets).where(eq(tickets.partnerId, partnerA));
    await db.delete(tickets).where(eq(tickets.partnerId, partnerB));
    await db.delete(memberships).where(eq(memberships.partnerId, partnerA));
    await db.delete(users).where(eq(users.id, userNlId));
    await db.delete(users).where(eq(users.id, userFrId));
    await db.delete(partners).where(eq(partners.id, partnerA));
    await db.delete(partners).where(eq(partners.id, partnerB));
  });

  it('returns per-language counts scoped to the calling partner', async () => {
    const caller = appRouter.createCaller({
      user: { id: userFrId, name: 'Fr User', email: 'fr@test', role: 'support', partnerId: partnerA, isPlatformOperator: false, isExternal: false, lang: 'fr' },
    } as unknown as CallerCtx);
    const rows = await caller.support.getStaffingByLanguage({ partnerId: partnerA });
    const nl = rows.find((r) => r.lang === 'nl');
    const fr = rows.find((r) => r.lang === 'fr');
    expect(nl?.unclaimedTickets).toBe(3);
    expect(fr?.unclaimedTickets).toBe(1);
    // partner B's nl ticket must NOT be counted
    expect(nl?.unclaimedTickets).not.toBe(4);
    // oldest nl wait is 10 minutes → critical (>5m with 0 online in presence for test env)
    expect(nl?.imbalanceLevel).toBe('critical');
  });

  it('rejects callers who are not a member of the partner', async () => {
    const caller = appRouter.createCaller({
      user: { id: userNlId, name: 'Nl User', email: 'nl@test', role: 'support', partnerId: partnerA, isPlatformOperator: false, isExternal: false, lang: 'nl' },
    } as unknown as CallerCtx);
    await expect(caller.support.getStaffingByLanguage({ partnerId: partnerB })).rejects.toThrow(/FORBIDDEN|not a member/i);
  });

  it('returns empty array when queueLangAwareness is off on the partner', async () => {
    // make userNl a member of B for this check
    await db.insert(memberships).values({ id: randomUUID(), userId: userNlId, partnerId: partnerB, role: 'support', departments: [] });
    const caller = appRouter.createCaller({
      user: { id: userNlId, name: 'Nl User', email: 'nl@test', role: 'support', partnerId: partnerB, isPlatformOperator: false, isExternal: false, lang: 'nl' },
    } as unknown as CallerCtx);
    const rows = await caller.support.getStaffingByLanguage({ partnerId: partnerB });
    expect(rows).toEqual([]);
    await db.delete(memberships).where(eq(memberships.userId, userNlId));
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
docker compose exec server npx vitest run trpc/routers/support.test.ts
```

Expected: FAIL — `getStaffingByLanguage` is not defined on the router.

- [ ] **Step 3: Implement the endpoint**

Replace the contents of `server/trpc/routers/support.ts` with:

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, tickets, memberships } from '../../db/schema.js';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { getOnlineUsersForPartner } from '../../services/presence.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
import type { UserRole } from '../../types/index.js';
import logger from '../../utils/logger.js';

export interface ImbalanceInput {
  online: number;
  waiting: number;
  oldestWaitMinutes: number;
}

export type ImbalanceLevel = 'ok' | 'thin' | 'critical';

export function classifyImbalance(input: ImbalanceInput): ImbalanceLevel {
  const { online, waiting, oldestWaitMinutes } = input;
  if (waiting === 0) return 'ok';
  if (online === 0) {
    if (waiting >= 3 || oldestWaitMinutes > 5) return 'critical';
    return 'thin';
  }
  const ratio = waiting / online;
  if (ratio >= 10) return 'thin';
  if (ratio <= 5) return 'ok';
  return 'ok';
}

const SUPPORTED_LANGS = ['nl', 'fr', 'en'] as const;
type SupportedLang = typeof SUPPORTED_LANGS[number];

export interface StaffingRow {
  lang: SupportedLang;
  onlineSupport: number;
  unclaimedTickets: number;
  averageWaitMinutes: number | null;
  imbalanceLevel: ImbalanceLevel;
}

async function assertMembership(userId: string, partnerId: string, isPlatformOperator: boolean): Promise<void> {
  if (isPlatformOperator) return;
  const rows = await db.select().from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, partnerId)))
    .limit(1);
  if (rows.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'not a member of this partner' });
  }
}

export const supportRouter = router({
  getStaffingByLanguage: protectedProcedure
    .input(z.object({ partnerId: z.string() }))
    .query(async ({ input, ctx }): Promise<StaffingRow[]> => {
      await assertMembership(ctx.user.id, input.partnerId, !!ctx.user.isPlatformOperator);

      const partner = await db.select().from(partners).where(eq(partners.id, input.partnerId)).limit(1);
      if (partner.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'partner not found' });
      }
      const flags = (partner[0].aiFeatures as Record<string, unknown>) || {};
      if (flags.queueLangAwareness !== true) return [];

      const online = await getOnlineUsersForPartner(input.partnerId);
      const staffByLang: Record<SupportedLang, number> = { nl: 0, fr: 0, en: 0 };
      for (const u of online) {
        if (!canUseSupportWorkflows(u.role as UserRole, false)) continue;
        const lang = (u as { lang?: string }).lang as SupportedLang | undefined;
        if (lang && SUPPORTED_LANGS.includes(lang)) staffByLang[lang] += 1;
      }

      const openTickets = await db.select({
        agentLang: tickets.agentLang,
        createdAt: tickets.createdAt,
      }).from(tickets).where(and(
        eq(tickets.partnerId, input.partnerId),
        isNull(tickets.supportId),
        inArray(tickets.status, ['open', 'pending']),
      ));

      const now = Date.now();
      const rowsByLang: Record<SupportedLang, { count: number; oldestMinutes: number; totalMinutes: number }> = {
        nl: { count: 0, oldestMinutes: 0, totalMinutes: 0 },
        fr: { count: 0, oldestMinutes: 0, totalMinutes: 0 },
        en: { count: 0, oldestMinutes: 0, totalMinutes: 0 },
      };
      for (const t of openTickets) {
        const lang = (t.agentLang as SupportedLang | null) ?? 'en';
        if (!SUPPORTED_LANGS.includes(lang)) continue;
        const ageMinutes = Math.max(0, Math.floor((now - new Date(t.createdAt).getTime()) / 60_000));
        rowsByLang[lang].count += 1;
        rowsByLang[lang].oldestMinutes = Math.max(rowsByLang[lang].oldestMinutes, ageMinutes);
        rowsByLang[lang].totalMinutes += ageMinutes;
      }

      const result: StaffingRow[] = SUPPORTED_LANGS.map((lang) => {
        const waiting = rowsByLang[lang].count;
        const oldest = rowsByLang[lang].oldestMinutes;
        const avg = waiting > 0 ? Math.round(rowsByLang[lang].totalMinutes / waiting) : null;
        return {
          lang,
          onlineSupport: staffByLang[lang],
          unclaimedTickets: waiting,
          averageWaitMinutes: avg,
          imbalanceLevel: classifyImbalance({ online: staffByLang[lang], waiting, oldestWaitMinutes: oldest }),
        };
      });

      logger.debug({ partnerId: input.partnerId, result }, '[support.getStaffingByLanguage]');
      return result;
    }),
});
```

- [ ] **Step 4: Register the router**

Edit `server/trpc/router.ts`. Add the import at the top (after the other router imports):

```ts
import { supportRouter } from './routers/support.js';
```

And add `support: supportRouter,` to the `appRouter` object (any position is fine; keep alphabetical if the file is sorted, but the existing file isn't strictly sorted — place it next to `stats`):

```ts
export const appRouter = router({
  status: statusRouter,
  ai: aiRouter,
  cannedResponse: cannedResponseRouter,
  kb: kbRouter,
  label: labelRouter,
  ticket: ticketRouter,
  message: messageRouter,
  presence: presenceRouter,
  feedback: feedbackRouter,
  rating: ratingRouter,
  savedView: savedViewRouter,
  stats: statsRouter,
  support: supportRouter,
  user: userRouter,
  platform: platformRouter,
  partner: partnerRouter,
  alerts: alertsRouter,
  webhook: webhookRouter,
  linkPreview: linkPreviewRouter,
  sla: slaRouter,
});
```

- [ ] **Step 5: Run the test**

```bash
docker compose exec server npx vitest run trpc/routers/support.test.ts
```

Expected: all tests pass (9 total).

- [ ] **Step 6: Commit**

```bash
git add server/trpc/routers/support.ts server/trpc/routers/support.test.ts server/trpc/router.ts
git commit -m "feat(routing): add support.getStaffingByLanguage endpoint"
```

---

## Task 5: Language badge on QueueTicketRow

**Files:**
- Create: `client/src/components/support/LangBadge.tsx`
- Modify: `client/src/components/support/QueueTicketRow.tsx`
- Modify: `client/src/hooks/useTranslation.ts` (no change this task — keep in mind that `useLang()` from `../../i18n` gives us the viewer language)

- [ ] **Step 1: Create the LangBadge component**

Create `client/src/components/support/LangBadge.tsx`:

```tsx
interface LangBadgeProps {
  lang: string | null | undefined;
  viewerLang: string;
  className?: string;
}

/**
 * 2-letter language chip for queue rows and headers. When the ticket language
 * differs from the viewer's language, the badge is drawn in accent-blue so the
 * eye catches cross-lang tickets at a glance; same-lang badges render muted.
 */
export default function LangBadge({ lang, viewerLang, className }: LangBadgeProps) {
  if (!lang) return null;
  const isCrossLang = lang !== viewerLang;
  const colorClass = isCrossLang
    ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
    : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <span
      data-lang-badge={lang}
      data-cross-lang={isCrossLang ? 'true' : 'false'}
      className={`font-mono text-[8px] font-bold uppercase tracking-[0.5px] px-[4px] py-px border shrink-0 ${colorClass} ${className ?? ''}`}
    >
      {lang.toUpperCase()}
    </span>
  );
}
```

- [ ] **Step 2: Render the badge in QueueTicketRow**

Edit `client/src/components/support/QueueTicketRow.tsx`. Add the import (after the existing `AgentBadges` import, line 5):

```tsx
import LangBadge from './LangBadge';
import { useLang } from '../../i18n';
```

Inside the component (after the `agentOnline` line at ~line 41), add:

```tsx
const viewerLang = useLang();
```

Then in the JSX (Row 1, next to the dept badge), insert the badge right after the dept `<span>` at line 104-107. Replace:

```tsx
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] shrink-0">
          {ticket.dept}
        </span>
        {agentOnline && (
```

with:

```tsx
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-mono text-[7px] font-bold uppercase tracking-[0.5px] px-[5px] py-px border border-[var(--color-accent-blue)] text-[var(--color-accent-blue)] shrink-0">
          {ticket.dept}
        </span>
        <LangBadge lang={ticket.agentLang} viewerLang={viewerLang} />
        {agentOnline && (
```

- [ ] **Step 3: Typecheck**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Write a smoke unit test**

Create `client/src/components/support/__tests__/LangBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LangBadge from '../LangBadge';

describe('LangBadge', () => {
  it('marks cross-lang tickets with data-cross-lang=true', () => {
    render(<LangBadge lang="nl" viewerLang="fr" />);
    const el = screen.getByText('NL');
    expect(el.getAttribute('data-cross-lang')).toBe('true');
  });

  it('marks same-lang tickets with data-cross-lang=false', () => {
    render(<LangBadge lang="fr" viewerLang="fr" />);
    const el = screen.getByText('FR');
    expect(el.getAttribute('data-cross-lang')).toBe('false');
  });

  it('renders nothing when lang is null', () => {
    const { container } = render(<LangBadge lang={null} viewerLang="fr" />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 5: Run test**

```bash
docker compose exec client npx vitest run src/components/support/__tests__/LangBadge.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/support/LangBadge.tsx client/src/components/support/QueueTicketRow.tsx client/src/components/support/__tests__/LangBadge.test.tsx
git commit -m "feat(routing): add per-ticket language badge on queue rows"
```

---

## Task 6: StaffingHeader component

**Files:**
- Create: `client/src/components/support/StaffingHeader.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/support/StaffingHeader.tsx`:

```tsx
import { useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT, useLang } from '../../i18n';
import { getSocket } from '../../hooks/useSocket';

type StaffingLang = 'nl' | 'fr' | 'en';

interface StaffingHeaderProps {
  partnerId: string;
  filterLang: StaffingLang | null;
  onToggleLang: (lang: StaffingLang | null) => void;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/**
 * Per-language staffing card, polled every 30s and refetched on `presence:change`.
 * Critical columns render in accent-red; thin in accent-amber; ok in muted.
 * Click a column to filter the ticket list to that language (toggleable).
 * Hidden when partner has queueLangAwareness=false (endpoint returns empty array).
 */
export default function StaffingHeader({ partnerId, filterLang, onToggleLang }: StaffingHeaderProps) {
  const t = useT();
  const viewerLang = useLang();
  const utils = trpc.useUtils();
  const { data } = trpc.support.getStaffingByLanguage.useQuery(
    { partnerId },
    { refetchInterval: 30_000, staleTime: 15_000 },
  );

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refetch = () => { utils.support.getStaffingByLanguage.invalidate({ partnerId }); };
    socket.on('presence:change', refetch);
    socket.on('support:online', refetch);
    return () => {
      socket.off('presence:change', refetch);
      socket.off('support:online', refetch);
    };
  }, [utils, partnerId]);

  if (!data || data.length === 0) return null;
  // Hide entirely when every language has zero waiting AND zero staff
  // (fresh partner, off-hours). Keeps the sidebar clean.
  const hasSignal = data.some((r) => r.unclaimedTickets > 0 || r.onlineSupport > 0);
  if (!hasSignal) return null;

  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)]">
      <div className="mono-label text-[var(--color-text-muted)] mb-2">{t('queue_staffing_heading')}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {data.map((row) => {
          const isActive = filterLang === row.lang;
          const isViewerLang = row.lang === viewerLang;
          const level = row.imbalanceLevel;
          const color =
            level === 'critical' ? 'text-[var(--color-accent-red)] border-[var(--color-accent-red)]'
            : level === 'thin'   ? 'text-[var(--color-accent-amber)] border-[var(--color-accent-amber)]'
                                 : 'text-[var(--color-text-muted)] border-[var(--color-border)]';
          const activeClass = isActive
            ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] border-[var(--color-text-primary)]'
            : '';
          return (
            <button
              key={row.lang}
              type="button"
              data-staffing-lang={row.lang}
              data-imbalance={level}
              onClick={() => onToggleLang(isActive ? null : row.lang)}
              aria-pressed={isActive}
              title={isViewerLang ? 'Your language' : `Filter queue to ${row.lang.toUpperCase()}`}
              className={`flex flex-col gap-0.5 border px-2 py-1.5 text-left ${color} ${activeClass} hover:opacity-80`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">{row.lang.toUpperCase()}</span>
                {level !== 'ok' && <span aria-hidden="true" className="font-mono text-[9px]">!</span>}
              </div>
              <span className="font-mono text-[9px] tabular-nums">{interpolate(t('queue_staffing_online'), { n: row.onlineSupport })}</span>
              <span className="font-mono text-[9px] tabular-nums">{interpolate(t('queue_staffing_waiting'), { n: row.unclaimedTickets })}</span>
              {row.averageWaitMinutes !== null && (
                <span className="font-mono text-[9px] tabular-nums opacity-70">
                  {interpolate(t('queue_staffing_oldest'), { duration: `${row.averageWaitMinutes}m` })}
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

- [ ] **Step 2: Typecheck**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/support/StaffingHeader.tsx
git commit -m "feat(routing): add StaffingHeader component"
```

---

## Task 7: Integrate StaffingHeader into QueueSidebar

**Files:**
- Modify: `client/src/components/support/QueueSidebar.tsx`

- [ ] **Step 1: Add state + render**

Edit `client/src/components/support/QueueSidebar.tsx`:

1. Add import near the top (after `SidebarFooter` at line 11):

```tsx
import StaffingHeader from './StaffingHeader';
```

2. Add filter state inside the component (after the existing `setOtherAgentsExpanded` line at ~line 51):

```tsx
const [filterLang, setFilterLang] = useState<'nl' | 'fr' | 'en' | null>(null);
```

3. Modify the `queueFiltered` memo (lines 145-154) to also apply language filter. Replace:

```tsx
  const queueFiltered = useMemo(
    () =>
      tickets.filter(
        (tk) =>
          tk.status !== 'closed' &&
          (filterDept === 'all' || tk.dept === filterDept) &&
          ticketDeptAllowed(tk.dept),
      ),
    [tickets, filterDept, ticketDeptAllowed],
  );
```

with:

```tsx
  const queueFiltered = useMemo(
    () =>
      tickets.filter(
        (tk) =>
          tk.status !== 'closed' &&
          (filterDept === 'all' || tk.dept === filterDept) &&
          (!filterLang || tk.agentLang === filterLang) &&
          ticketDeptAllowed(tk.dept),
      ),
    [tickets, filterDept, filterLang, ticketDeptAllowed],
  );
```

4. Render the header above the ticket list. Find the `<div className="flex-1 overflow-y-auto">` (line 249) and insert `<StaffingHeader />` just BEFORE it, inside the outer fragment after the existing dept chips block at line 228 (closing `</div>`). Specifically, add right after that closing tag:

```tsx
      <StaffingHeader
        partnerId={activeMembership.partnerId}
        filterLang={filterLang}
        onToggleLang={setFilterLang}
      />
```

- [ ] **Step 2: Typecheck**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/support/QueueSidebar.tsx
git commit -m "feat(routing): mount StaffingHeader above QueueSidebar ticket list"
```

---

## Task 8: Cross-lang banner in ChatHeader

**Files:**
- Modify: `client/src/components/chat/ChatHeader.tsx`
- Create: `client/src/components/chat/__tests__/ChatHeader.crossLang.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/chat/__tests__/ChatHeader.crossLang.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Minimal store + translation stubs; real ChatHeader has many deps so we
// render a lightweight wrapper that exercises just the banner branch.
vi.mock('../../../store/useStore', () => ({
  default: (selector: (s: unknown) => unknown) => selector({
    allLabels: [],
    onlineSupportUsers: [],
    user: { id: 'u1', role: 'support', lang: 'fr', isExternal: false },
  }),
  useStoreShallow: (selector: (s: unknown) => unknown) => selector({
    allLabels: [],
    onlineSupportUsers: [],
  }),
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key === 'chat_cross_lang_banner' ? 'Replies are auto-translated to {lang} for the agent.' : key,
  useLang: () => 'fr',
}));

vi.mock('../../../hooks/usePartner', () => ({ usePartner: () => ({ manifest: { departments: [] } }) }));
vi.mock('../../../hooks/useSocket', () => ({ getSocket: () => null }));
vi.mock('../../UserAvatar', () => ({ default: () => null }));
vi.mock('../../SlaIndicator', () => ({ default: () => null }));

import ChatHeader from '../ChatHeader';

function makeTicket(agentLang: string) {
  return {
    id: 't1', partnerId: 'p', agentId: 'a', agentName: 'Agent', agentLang,
    dept: 'support', status: 'open', supportId: null, participants: [], references: [], labels: [],
  } as unknown as Parameters<typeof ChatHeader>[0]['ticket'];
}

describe('ChatHeader cross-lang banner', () => {
  it('renders the banner when ticket lang differs from viewer lang', () => {
    const ticket = makeTicket('nl');
    render(<ChatHeader
      ticket={ticket} liveTicket={ticket}
      isSupport={true} isClosed={false}
      focusMode={false} compact={false}
      showTransferMenu={false} setShowTransferMenu={() => {}} onTransfer={() => {}}
      closing={false} canClose={true} agentIsOnline={true}
      onCloseTicket={() => {}}
    />);
    expect(screen.getByText(/auto-translated to NL/i)).toBeInTheDocument();
  });

  it('omits the banner when ticket lang matches viewer lang', () => {
    const ticket = makeTicket('fr');
    render(<ChatHeader
      ticket={ticket} liveTicket={ticket}
      isSupport={true} isClosed={false}
      focusMode={false} compact={false}
      showTransferMenu={false} setShowTransferMenu={() => {}} onTransfer={() => {}}
      closing={false} canClose={true} agentIsOnline={true}
      onCloseTicket={() => {}}
    />);
    expect(screen.queryByText(/auto-translated/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

```bash
docker compose exec client npx vitest run src/components/chat/__tests__/ChatHeader.crossLang.test.tsx
```

Expected: FAIL — banner text not present.

- [ ] **Step 3: Render the banner in ChatHeader**

Edit `client/src/components/chat/ChatHeader.tsx`.

1. Add import to the existing i18n import (line 3). Replace:

```tsx
import { useT } from '../../i18n';
```

with:

```tsx
import { useT, useLang } from '../../i18n';
```

2. Inside the component body (after the `t = useT();` line at line 82), add:

```tsx
  const viewerLang = useLang();
  const isCrossLang = !!ticket.agentLang && ticket.agentLang !== viewerLang && isSupport;
```

3. Add a helper for template interpolation just above the return statement (near line 183):

```tsx
  function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }
```

4. Render the banner row below the main header row. Find the closing `</div>` of the main header flex row (at line 527 — just before the "Collision Detection bar" comment on line 530). Insert right BEFORE that closing `</div>`:

```tsx
        {isCrossLang && !focusMode && !compact && !isClosed && (
          <div
            data-cross-lang-banner
            className="px-4 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] font-mono text-[10px] text-[var(--color-text-muted)]"
          >
            {interpolate(t('chat_cross_lang_banner'), { lang: (ticket.agentLang ?? '').toUpperCase() })}
          </div>
        )}
```

- [ ] **Step 4: Run the test**

```bash
docker compose exec client npx vitest run src/components/chat/__tests__/ChatHeader.crossLang.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/chat/ChatHeader.tsx client/src/components/chat/__tests__/ChatHeader.crossLang.test.tsx
git commit -m "feat(routing): add cross-lang banner to ChatHeader"
```

---

## Task 9: Server-side pre-warm of translations in message broadcast

When a message is sent into a cross-lang ticket with `translation` AND `queueLangAwareness` both on, the server calls the AI translate provider for each distinct viewer-language currently watching the ticket and attaches a `translations: { [lang]: text }` map to the `message:new` payload. The client's `useAutoTranslation` hook picks up pre-warmed text without firing its own tRPC call — eliminating the ~300ms flash.

**Files:**
- Modify: `server/socket/handlers/message.ts`
- Modify: `client/src/types/index.ts` (add `translations?: Record<string, string>` to `Message`)
- Modify: `client/src/hooks/useTranslation.ts` (consume pre-warmed value)

- [ ] **Step 1: Write a server-side unit test for the pre-warm gate**

Create `server/socket/handlers/message.prewarm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computePrewarmTargets } from './message.js';

describe('computePrewarmTargets', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns empty when partner has queueLangAwareness off', () => {
    const out = computePrewarmTargets({
      senderLang: 'fr', ticketAgentLang: 'nl',
      viewerLangs: new Set(['nl', 'fr']),
      aiFeatures: { translation: true, queueLangAwareness: false },
    });
    expect(out).toEqual([]);
  });

  it('returns empty when translation feature off', () => {
    const out = computePrewarmTargets({
      senderLang: 'fr', ticketAgentLang: 'nl',
      viewerLangs: new Set(['nl', 'fr']),
      aiFeatures: { translation: false, queueLangAwareness: true },
    });
    expect(out).toEqual([]);
  });

  it('returns viewer langs distinct from sender lang when both flags on', () => {
    const out = computePrewarmTargets({
      senderLang: 'fr', ticketAgentLang: 'nl',
      viewerLangs: new Set(['nl', 'fr', 'en']),
      aiFeatures: { translation: true, queueLangAwareness: true },
    });
    expect(out.sort()).toEqual(['en', 'nl']);
  });

  it('returns empty when ticket is same-lang (no one needs translation)', () => {
    const out = computePrewarmTargets({
      senderLang: 'fr', ticketAgentLang: 'fr',
      viewerLangs: new Set(['fr']),
      aiFeatures: { translation: true, queueLangAwareness: true },
    });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
docker compose exec server npx vitest run socket/handlers/message.prewarm.test.ts
```

Expected: FAIL — `computePrewarmTargets` not exported.

- [ ] **Step 3: Add and export `computePrewarmTargets`**

Edit `server/socket/handlers/message.ts`. Add the helper at the top of the file (after the imports block, before `export function register`):

```ts
export interface PrewarmInput {
  senderLang: string;
  ticketAgentLang: string | null;
  viewerLangs: Set<string>;
  aiFeatures: { translation?: boolean; queueLangAwareness?: boolean } | null | undefined;
}

export function computePrewarmTargets(input: PrewarmInput): string[] {
  const f = input.aiFeatures || {};
  if (!f.translation || !f.queueLangAwareness) return [];
  if (!input.ticketAgentLang || input.ticketAgentLang === input.senderLang) return [];
  const targets = new Set<string>();
  for (const vl of input.viewerLangs) {
    if (vl && vl !== input.senderLang) targets.add(vl);
  }
  return Array.from(targets);
}
```

- [ ] **Step 4: Run the unit test**

```bash
docker compose exec server npx vitest run socket/handlers/message.prewarm.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Wire pre-warm into `message:send`**

In the same file, add these imports at the top:

```ts
import { runAiAction } from '../../services/ai/index.js';
import { db } from '../../db.js';
import { partners } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
```

**Why a direct db query, not `getPartnerAiConfig`:** `services/ai/config.ts` only returns the 4 original feature keys (messageImprovement, chatSummarization, translation, autoSummarizeOnClose) and drops unknown keys. We need `queueLangAwareness`, so read the raw JSONB.

**Why not `findPartnerConfig`:** `services/partnerQueries.ts::findPartnerConfig` only returns `{status, businessHoursSchedule}`. It does not expose `aiFeatures`.

Replace the block inside `socket.on('message:send', ...)` from line 192 to line 213 — the section from `// Resolve reply snippet for broadcast` through the `message:new` emit. Insert the pre-warm between the reply snippet resolution and the emit. The new block:

```ts
      // Resolve reply snippet for broadcast (if replying to a message)
      let broadcastPayload: typeof msgPayload & {
        localId?: string;
        replyTo?: { id: string; senderName: string; text: string; mediaUrl: string | null } | null;
        translations?: Record<string, string>;
      } = localId ? { ...msgPayload, localId } : msgPayload;
      if (replyToId) {
        const snippet = await resolveReplySnippet(replyToId);
        broadcastPayload = { ...broadcastPayload, replyTo: snippet };
      }

      // Pre-warm cross-lang translations for the agent(s) watching this
      // ticket in a different language. Gated on partner aiFeatures so
      // non-translating tenants skip the AI call entirely. Non-fatal: on
      // any provider error, client-side useAutoTranslation still catches
      // up on render (old behavior, minus the pre-warm).
      try {
        const partnerRow = await db
          .select({ aiFeatures: partners.aiFeatures })
          .from(partners)
          .where(eq(partners.id, ticket.partnerId))
          .limit(1);
        const aiFeatures = (partnerRow[0]?.aiFeatures as Record<string, unknown>) || {};
        const roomSockets = await ctx.io.in(Rooms.ticket(ticketId)).fetchSockets();
        const viewerLangs = new Set<string>();
        for (const s of roomSockets) {
          if (s.id === socket.id) continue;
          const lg = (s.data.lang as string) || '';
          if (lg) viewerLangs.add(lg);
        }
        const targets = computePrewarmTargets({
          senderLang: sender.lang,
          ticketAgentLang: ticket.agentLang ?? null,
          viewerLangs,
          aiFeatures: aiFeatures as { translation?: boolean; queueLangAwareness?: boolean },
        });
        if (targets.length > 0 && guardedText) {
          const translations: Record<string, string> = {};
          const langLabel = (l: string) =>
            l === 'nl' ? 'Dutch' : l === 'fr' ? 'French' : 'English';
          await Promise.all(targets.map(async (tl) => {
            try {
              const res = await runAiAction({
                partnerId: ticket.partnerId,
                userId: senderId,
                feature: 'translation',
                action: 'translate',
                vars: { text: guardedText, targetLang: langLabel(tl) },
                temperature: 0.3,
                maxTokens: 1024,
              });
              if (res.content) translations[tl] = res.content.trim();
            } catch (err) {
              logger.debug({ err: err instanceof Error ? err.message : String(err), tl }, '[message:send] pre-warm translate failed (non-fatal)');
            }
          }));
          if (Object.keys(translations).length > 0) {
            broadcastPayload = { ...broadcastPayload, translations };
          }
        }
      } catch (err) {
        logger.debug({ err: err instanceof Error ? err.message : String(err) }, '[message:send] pre-warm skipped (non-fatal)');
      }

      if (isWhisper) {
        const roomSockets = await ctx.io.in(Rooms.ticket(ticketId)).fetchSockets();
        for (const s of roomSockets) {
          if (s.data.isSupport) {
            s.emit('message:new', broadcastPayload);
          }
        }
      } else {
        ctx.io.to(Rooms.ticket(ticketId)).emit('message:new', broadcastPayload);
      }
```

**Why these specific `runAiAction` opts:** `server/trpc/routers/ai.ts:47-69` is the canonical translate call site. It passes `feature: 'translation'`, `action: 'translate'`, maps the bare lang code to the full language name in `vars.targetLang`, and uses `temperature: 0.3, maxTokens: 1024`. We mirror it here. The return shape is `{content: string, model: string}` — `content.trim()` is the translated text. Any thrown `TRPCError` (rate-limit, feature disabled, provider down) falls into the inner catch and the broadcast proceeds un-prewarmed.

- [ ] **Step 6: Extend `Message` type on the client**

Edit `client/src/types/index.ts`. Find the `Message` interface and add:

```ts
translations?: Record<string, string>;
```

to its field list. (If the file is large, use Grep for `interface Message` or `type Message`.)

- [ ] **Step 7: Consume pre-warmed translations in the hook**

Edit `client/src/hooks/useTranslation.ts`. Add an optional `prewarmed` field to the input. After the import block, change the hook signature (line 59) from:

```ts
export function useAutoTranslation(opts: {
  messageId: string;
  text: string;
  senderLang: string;
  viewerLang: string;
  enabled: boolean;
}) {
```

to:

```ts
export function useAutoTranslation(opts: {
  messageId: string;
  text: string;
  senderLang: string;
  viewerLang: string;
  enabled: boolean;
  prewarmed?: string;
}) {
```

Then extract `prewarmed` from `opts` (line 66):

```ts
const { messageId, text, senderLang, viewerLang, enabled, prewarmed } = opts;
```

Seed the cache with the pre-warmed value on first render (immediately after `const cacheKey = …` line, around line 68):

```ts
  if (prewarmed && !translationCache.has(cacheKey)) {
    cacheSet(cacheKey, prewarmed);
  }
```

Update the initial state to read from cache (line 70 — already correct since `cacheSet` above primed it). No further change needed in the hook; callers pass `prewarmed={message.translations?.[viewerLang]}`.

- [ ] **Step 8: Wire the caller**

Find the MessageBubble or ChatWindow that currently calls `useAutoTranslation`:

```bash
docker compose exec client grep -rn 'useAutoTranslation' src/components
```

In each call site, pass `prewarmed={message.translations?.[viewerLang]}`. Keep the existing `text`, `senderLang`, etc. exactly as-is.

- [ ] **Step 9: Typecheck + tests**

```bash
docker compose exec server npx tsc --noEmit
docker compose exec client npx tsc --noEmit
docker compose exec server npx vitest run socket/handlers/message.prewarm.test.ts
```

Expected: all exit 0 / pass.

- [ ] **Step 10: Commit**

```bash
git add server/socket/handlers/message.ts server/socket/handlers/message.prewarm.test.ts client/src/types/index.ts client/src/hooks/useTranslation.ts client/src/components
git commit -m "feat(routing): pre-warm cross-lang translations in message broadcast"
```

---

## Task 10: Metrics + Prometheus alert

**Files:**
- Modify: `server/utils/metrics.ts`
- Modify: `server/trpc/routers/support.ts` (emit gauges on each query)
- Modify: `monitoring/alerts.yml`

- [ ] **Step 1: Add metrics**

Append to `server/utils/metrics.ts`:

```ts
// Language-aware queue routing. Emitted on every support.getStaffingByLanguage
// query (once per poll per connected support session). The imbalance gauge is
// a numeric code (0=ok, 1=thin, 2=critical) so Grafana can page on >=2 for a
// (partner, lang) pair.
export const queueUnclaimedByLang = new client.Gauge({
  name: 'guichet_queue_unclaimed_by_lang',
  help: 'Unclaimed tickets per language, last sampled by the staffing endpoint',
  labelNames: ['partner_id', 'lang'],
});

export const queueOldestUnclaimedSeconds = new client.Gauge({
  name: 'guichet_queue_oldest_unclaimed_seconds',
  help: 'Age in seconds of the oldest unclaimed ticket per language',
  labelNames: ['partner_id', 'lang'],
});

export const queueStaffingImbalance = new client.Gauge({
  name: 'guichet_queue_staffing_imbalance',
  help: 'Imbalance severity per language, coded 0=ok / 1=thin / 2=critical',
  labelNames: ['partner_id', 'lang'],
});

export const crossLangPickupTotal = new client.Counter({
  name: 'guichet_cross_lang_pickup_total',
  help: 'Messages sent by support into a ticket whose agentLang differs from support lang',
  labelNames: ['partner_id', 'support_lang', 'ticket_lang'],
});
```

- [ ] **Step 2: Emit gauges from the staffing endpoint**

Edit `server/trpc/routers/support.ts`. Import the metrics:

```ts
import { queueUnclaimedByLang, queueOldestUnclaimedSeconds, queueStaffingImbalance } from '../../utils/metrics.js';
```

After building `result` (just before `return result` in `getStaffingByLanguage`), add:

```ts
      const levelCode: Record<ImbalanceLevel, number> = { ok: 0, thin: 1, critical: 2 };
      for (const row of result) {
        queueUnclaimedByLang.set({ partner_id: input.partnerId, lang: row.lang }, row.unclaimedTickets);
        const oldestSeconds = rowsByLang[row.lang].oldestMinutes * 60;
        queueOldestUnclaimedSeconds.set({ partner_id: input.partnerId, lang: row.lang }, oldestSeconds);
        queueStaffingImbalance.set({ partner_id: input.partnerId, lang: row.lang }, levelCode[row.imbalanceLevel]);
      }
```

- [ ] **Step 3: Emit cross-lang pickup counter**

Edit `server/socket/handlers/message.ts`. After the existing `socketioEventsTotal.inc({ event: 'message:send' });` line, add (inside the try block, once `sender` and `ticket` are known):

```ts
      if (sender.lang && ticket.agentLang && sender.lang !== ticket.agentLang && socket.data.isSupport) {
        crossLangPickupTotal.inc({ partner_id: ticket.partnerId, support_lang: sender.lang, ticket_lang: ticket.agentLang });
      }
```

Add the import at the top:

```ts
import { crossLangPickupTotal } from '../../utils/metrics.js';
```

- [ ] **Step 4: Add the Prometheus alert**

Append a new group to `monitoring/alerts.yml`:

```yaml
  - name: queue-lang-awareness
    interval: 30s
    rules:
      - alert: QueueLangCritical
        expr: max by (partner_id, lang) (guichet_queue_staffing_imbalance) >= 2
        for: 10m
        labels:
          severity: warning
          subsystem: routing
        annotations:
          summary: 'No staffing for {{ $labels.lang }} queue at {{ $labels.partner_id }}'
          description: |
            support.getStaffingByLanguage reports imbalance=critical for partner
            {{ $labels.partner_id }}, language {{ $labels.lang }} for >=10 minutes.
            Zero online support users speak this language AND there are >=3
            waiting tickets (or the oldest wait exceeds 5 minutes). Expected
            behavior is that cross-language support pick up from the queue via
            the per-viewer translation pipeline; a persistent critical signal
            means the queue language awareness UI is not surfacing the
            imbalance OR no cross-language support is online. Check the
            StaffingHeader in the support sidebar and nudge staffing.
```

- [ ] **Step 5: Typecheck + reload prometheus config**

```bash
docker compose exec server npx tsc --noEmit
docker compose kill -s HUP prometheus || docker compose restart prometheus
```

Expected: tsc exit 0; prometheus reloads without errors in `docker logs guichet-prometheus-1`.

- [ ] **Step 6: Commit**

```bash
git add server/utils/metrics.ts server/trpc/routers/support.ts server/socket/handlers/message.ts monitoring/alerts.yml
git commit -m "feat(routing): add per-lang staffing metrics and QueueLangCritical alert"
```

---

## Task 11: E2E spec

**Files:**
- Create: `testing/e2e/queue-lang-awareness.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

Create `testing/e2e/queue-lang-awareness.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Playwright E2E. Seeds a partner with queueLangAwareness on, logs in a fr
// support user via /dev-login, and walks through: staffing header visible
// with a critical nl column, language filter reduces the queue, opening a
// nl ticket surfaces the cross-lang banner, and sending a reply delivers a
// pre-warmed nl translation to the agent view.

test.describe('Language-aware queue routing', () => {
  test.beforeAll(async () => {
    // Seeding strategy: the local CI script (scripts/ci.ps1) runs
    // npx tsx seed.ts before Playwright. Extend seed.ts separately to include
    // a bilingual partner fixture OR set queueLangAwareness via a tRPC call in
    // a setup hook. For now, this spec relies on an existing seeded partner
    // with nl agents waiting and at least one fr support user available.
  });

  test('staffing header shows nl critical for a fr support viewer', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('dev-login-fr-support').click();
    await page.waitForURL('**/support');

    const nlColumn = page.locator('[data-staffing-lang="nl"]');
    await expect(nlColumn).toBeVisible();
    await expect(nlColumn).toHaveAttribute('data-imbalance', /thin|critical/);
  });

  test('clicking nl column filters the ticket list to nl', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('dev-login-fr-support').click();
    await page.waitForURL('**/support');

    await page.locator('[data-staffing-lang="nl"]').click();
    const visibleLangBadges = page.locator('[data-lang-badge]');
    const count = await visibleLangBadges.count();
    for (let i = 0; i < count; i++) {
      await expect(visibleLangBadges.nth(i)).toHaveAttribute('data-lang-badge', 'nl');
    }
  });

  test('opening a cross-lang ticket surfaces the banner', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('dev-login-fr-support').click();
    await page.waitForURL('**/support');

    await page.locator('[data-ticket-row][data-ticket-variant="queue"]').first().click();
    await expect(page.locator('[data-cross-lang-banner]')).toBeVisible();
    await expect(page.locator('[data-cross-lang-banner]')).toContainText('NL');
  });
});
```

- [ ] **Step 2: Run the E2E locally**

```bash
docker compose exec client npm run build
npx playwright test testing/e2e/queue-lang-awareness.spec.ts
```

Expected: 3 tests pass. If the dev-login fixture IDs are different, align with the existing tests in `testing/e2e/` (search for `dev-login-` in other spec files first).

- [ ] **Step 3: Commit**

```bash
git add testing/e2e/queue-lang-awareness.spec.ts
git commit -m "test(routing): E2E spec for language-aware queue routing"
```

---

## Task 12: Manual verification + rollout checklist

This task is not code — it's the sign-off checklist before merging. Run through each, tick the box only when you've seen it work in a browser.

- [ ] **Browser: staffing header hidden when flag is off**

  In EditPartnerModal, toggle `queueLangAwareness` off for the test partner. Open SupportView — the staffing header disappears. Toggle back on — it reappears.

- [ ] **Browser: critical column is visually distinguishable**

  With 0 fr support online and ≥3 fr tickets waiting, the fr column renders in accent-red with the `!` glyph. Verify `docker compose exec server npx drizzle-kit studio` shows the expected counts.

- [ ] **Browser: lang filter is exclusive**

  Click nl column → only nl tickets visible. Click again → filter clears, all langs visible again. Department filter and language filter compose (both can be active).

- [ ] **Browser: cross-lang banner i18n**

  Toggle the viewer's GUI language via LanguageSwitcher to nl, then fr. Banner text updates to the new language. `{lang}` placeholder shows the TICKET's lang code, not the viewer's.

- [ ] **Browser: pre-warm eliminates flash**

  Open devtools Network tab. Have a fr support send a message in a nl ticket. Observe: the message arrives already translated; no `/trpc/ai.translateMessage` call fires from the agent's browser.

- [ ] **Prometheus: gauges populated**

  `curl -s localhost:9090/api/v1/query?query=guichet_queue_staffing_imbalance` returns non-empty data. (Note: use the Grafana explore tab — curl from outside docker may be blocked by the metrics token.)

- [ ] **Alertmanager: QueueLangCritical wired**

  Force a 10-minute critical state by seeding a partner with ≥3 waiting nl tickets and no nl support. Verify the alert appears in Alertmanager UI at `http://localhost:9093`.

- [ ] **Rollback readiness**

  Toggle `queueLangAwareness=false` at the platform level for the test partner; UI falls back to the pre-feature behavior within 30s (next poll). No errors in server logs.

- [ ] **Commit the ticked checklist**

```bash
git add docs/superpowers/plans/2026-04-19-language-aware-routing.md
git commit -m "docs(routing): mark manual verification complete"
```

---

## Post-implementation

Once all tasks pass:

1. Enable `queueLangAwareness=true` for the bilingual partner that prompted this spec via EditPartnerModal.
2. Watch the cross-lang pickup counter for the first 24h — it's the product success signal. If it rises, the UX changes are working.
3. Schedule a follow-up review 7 days out to revisit open questions in the spec (banner dismissal cadence, admin-only vs support+admin visibility).
