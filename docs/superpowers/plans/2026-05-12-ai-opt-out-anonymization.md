# Per-werknemer AI-anonimisatie + admin-zichtbaarheid

**Date:** 2026-05-12
**Status:** Plan; awaiting green light to execute
**Author:** Bart + Claude

## Context

Guichet wordt door medium-enterprise partners ingezet als intern collaboration-tool tussen agenten en experten. Vandaag logt elke AI-actie (improve, translate, suggest, transcribe, classify, match_canned) een rij in `ai_usage_log` met de uitvoerende `userId`. Onder Belgische CAO 81, GDPR Art. 21, en de AI Act Annex III §4(b) is dat een persoonsgegeven-verwerking waartegen een werknemer bezwaar moet kunnen maken.

De `WORKS_COUNCIL_DISCLOSURE.md` (2026-05-12) belooft expliciet dit recht. Dit plan voert het in zonder dat de werknemer zijn productiviteits-tools (vertaling tussen NL/FR/EN-collega's, opschoning van uitleg) verliest. Aanpak: anonimiseer logs in plaats van features uitschakelen — de log-rij blijft staan voor partner-niveau kostenattributie en rate-limiting, maar de `userId`-kolom wordt `NULL` voor opt-out werknemers.

Volledige discussie en alternatieven (hard-uitschakelen A, granulair per actie C) zijn afgewogen in de grill-me-sessie van 2026-05-12. Optie B (anonimiseer + behoud tools) gekozen; forced-modus-nuance toegevoegd.

## Decisions

### Decision 1 — Anonimiseer logs, behoud features (optie B)

Een werknemer met `memberships.aiOptOut = true` krijgt elke AI-functie nog steeds: de sparkle-knop werkt, inkomende berichten worden vertaald, voice-dictatie blijft beschikbaar. Het enige verschil: bij elke AI-call schrijft de server `userId = NULL` in `ai_usage_log` (en `ai_feedback` waar van toepassing). Een collega aan de andere kant van de chat ervaart niets — beide werknemers behouden hun tools.

### Decision 2 — Forced improve-modus zakt naar optional voor opt-out werknemers

Als `partners.ai_config.messageImprovement = 'forced'` en `memberships.aiOptOut = true`, dan vertaalt de server dat voor díé werknemer naar `'optional'`: geen auto-rewrite bij versturen, sparkle-knop blijft beschikbaar als ze zelf willen. De partner-config blijft `forced` voor alle anderen.

### Decision 3 — Server is autoriteit; client krijgt effectieve config

Nieuwe tRPC-procedure `ai.getEffectiveConfig` levert de eindgebruiker zijn effectieve `messageImprovement`-mode (na opt-out-override) en zijn opt-out vlag. De `ComposeArea` leest dit, in plaats van zelf de override-regel te kennen. Eén bron van waarheid op de server.

### Decision 4 — Anonimisatie is onomkeerbaar

Wanneer een werknemer opt-out aan zet en daarna weer uit, blijven de eerder geschreven `userId = NULL`-rijen leeg. Er is geen mapping bewaard om terug te koppelen — dat is per GDPR-definitie het verschil tussen anonimisering (onomkeerbaar) en pseudonimisering (omkeerbaar). Help-tekst in UI vermeldt dit expliciet.

### Decision 5 — Admin ziet alleen aggregaat met k≥5-drempel

Op AdminAi-pagina staat één regel: "AI-anonimisatie aan: X van Y werknemers". Geen drill-down naar individuele namen — dat zou precies de individualisering zijn die CAO 81 verbiedt. Bij Y < 5 wordt het getal verborgen met tooltip "Te kleine groep voor anonimiseren" om k-anonimiteits-lekken te voorkomen.

### Decision 6 — Toggle-actie genereert geen individueel audit-log entry

Logging in `audit_log` met `userId` zou de WORM-keten permanent traceerbaar maken — contraproductief. Wel: dagelijkse aggregaat-telling kan in `daily_ai_usage`-achtige rollup, zonder naamkoppeling.

### Decision 7 — Default false, geen backfill

Bestaande memberships behouden hun gedrag. Werknemer moet de toggle bewust aanzetten — geen verrassingen bij rollout.

## Surface area

### Schema

Drizzle migration voegt één kolom toe aan `memberships`:

| Column | Type | Default | Notes |
|---|---|---|---|
| `ai_opt_out` | `boolean` | `false` | Werknemer-bezwaar tegen persoonlijke AI-tracking (GDPR Art. 21). |

Migratie `server/drizzle/0001_ai_opt_out.sql` — zes regels.

### Server

**`server/services/ai/optOut.ts`** (nieuw):
- `isUserOptedOut(partnerId, userId): Promise<boolean>` — leest `memberships.aiOptOut`. Redis-cache met 60s TTL keyed op `{partnerId, userId}` om query-druk in `runAiAction` te dempen.
- `invalidateOptOutCache(partnerId, userId): Promise<void>` — wordt aangeroepen door de set-mutation.

**`server/services/ai/runAction.ts`** (existing):
- Aan het begin van `runAiAction`: lookup `isUserOptedOut(opts.partnerId, opts.userId)`. Bewaar als `anonymize` boolean.
- In de twee `logUsage()`-aanroepen onderaan (success en error pad): geef `userId: anonymize ? null : opts.userId` mee.
- Geen andere logica wijzigt — feature gating, rate limiting, provider call gaan ongewijzigd door.

**`server/services/ai/usage.ts`** (existing):
- `logUsage` ondertekening accepteert al `userId: string | null` (kolom is nullable). Type-update als nodig.

**`server/services/ai/config.ts`** (existing):
- Nieuwe export `getEffectiveAiConfig(partnerId, userId)`: leest partner-config, leest opt-out, returnt `{ ...partnerConfig, messageImprovement: opt-out && partner-was-forced ? 'optional' : partnerConfig.messageImprovement, aiOptOut: bool }`.

**`server/trpc/routers/ai.ts`** (existing):
- `getEffectiveConfig` (nieuwe `protectedProcedure`): geen input; resolves `getEffectiveAiConfig(ctx.partnerId, ctx.user.id)`. Client roept bij login + na `setOptOut`-toggle.
- `setOptOut` (nieuwe `partnerScopedProcedure`): input `{ optOut: boolean }`; update `memberships.aiOptOut` voor `{userId, partnerId}`. Invalideert cache. Geen audit-log-entry. Returns `{ ok: true }`.
- `getAnonymizedCount` (nieuwe `partnerAdminProcedure`): returns `{ total: number, anonymized: number, hidden: boolean }` waarbij `hidden=true` als `total < 5` (dan zet `anonymized` op `null`). Geen individuele userIds in de respons.
- `submitFeedback` en `markImproveResult` (existing): pas dezelfde anonymize-logica toe op `ai_feedback.userId`.

**`server/trpc/routers/ai.test.ts`** — uitbreiden voor de nieuwe procedures.

### Client

**`client/src/components/ui/UserMenuChip.tsx`** (existing):
- Nieuwe sectie "AI" tussen Taal en Toegankelijkheid. Sectie-header gebruikt `SECTION`-stijl. Eén `ToggleSwitch`-rij met label-tekst en help-tekst.
- Optioneel tweede regeltje (alleen tonen als `effectiveConfig.partnerMessageImprovement === 'forced'`): "Auto-verbetering bij versturen wordt optioneel voor jou."
- Wire `onToggle` → `trpc.ai.setOptOut.useMutation` → `invalidate trpc.ai.getEffectiveConfig`.

**`client/src/locales/{nl,fr,en}.ts`** (existing):
- Nieuwe sleutels: `ai_section_title`, `ai_anonymize_toggle`, `ai_anonymize_help`, `ai_anonymize_forced_note`, `ai_anonymize_irreversible_help`.

**`client/src/components/chat/ComposeArea.tsx`** (existing):
- Vervang directe lezing van `partner.ai_config.messageImprovement` door `trpc.ai.getEffectiveConfig.useQuery`. De `forced`-pad blijft, maar werknemer met opt-out komt nu uit op `'optional'` en de auto-improve flow slaat de send-tijd-rewrite over.

**`client/src/components/admin/AdminAi.tsx`** (existing):
- Nieuwe sectie "Privacy & compliance" onder bestaande feature-toggles. Bevat:
  - `trpc.ai.getAnonymizedCount.useQuery` → toont "X van Y werknemers hebben AI-anonimisatie aan" of "Groep te klein" als `hidden=true`.
  - Link naar `docs/WORKS_COUNCIL_DISCLOSURE.md` (in-app renderable; zie volgende punt).
  - Link naar `docs/AI_ACT_AUDIT.md`.

**Nieuwe component `client/src/components/AiDisclosureModal.tsx`** (nieuw):
- Rendert de werkraad-doc als in-app modal (markdown via bestaande markdown-helper). Open vanuit AdminAi compliance-sectie en vanuit het discoverability-banner.

**Nieuwe component `client/src/components/AiDisclosureBanner.tsx`** (nieuw):
- Dismissable in-app info-balk: "Deze werkplek gebruikt AI-functies. Je kan je gebruik anonimiseren in [profielmenu]. Meer info."
- One-time-per-session opslag in `localStorage` keyed op `{userId, partnerId}` (zodat workspace-switch het opnieuw toont indien gewenst).
- Renderen in zowel `SupportView` als `AgentView` shells.

## Phasing

| Phase | Wat | Bestanden | PR? |
|---|---|---|---|
| 1 | Schema + server gate | schema.ts, drizzle/0001, optOut.ts, runAction.ts, config.ts, ai.ts router | Wel — backend kan eerst landen zonder UI |
| 2 | Toggle-UI in profielmenu | UserMenuChip.tsx, locales × 3 | Onderdeel van zelfde PR als phase 1 of opvolger |
| 3 | Compose-area effectieve config | ComposeArea.tsx | Opvolger; afhankelijk van phase 1+2 |
| 4 | Admin telling + compliance-sectie | AdminAi.tsx, AiDisclosureModal.tsx | Opvolger |
| 5 | Discoverability banner | AiDisclosureBanner.tsx, SupportView.tsx, AgentView.tsx | Opvolger of zelfde PR als phase 4 |

Voorstel: **phase 1 + 2 in PR 1**, **phase 3 + 4 + 5 in PR 2**. Reden: PR 1 levert het GDPR-recht functioneel af; PR 2 polijst zichtbaarheid en discoverability.

## Tests

Per fase:

**Phase 1 — server**
- `runAction.optOut.test.ts` (nieuw): met mock `isUserOptedOut` returning true, verifieer dat `logUsage` wordt aangeroepen met `userId: null`. Bij `false` blijft `userId` intact.
- `optOut.test.ts` (nieuw): cache-gedrag, invalidation.
- `ai.optOut.router.test.ts` (nieuw): `setOptOut` mutation update DB, `getEffectiveConfig` returnt geanonimiseerde of normale view, `getAnonymizedCount` past k-drempel toe.
- `tenant-isolation-guard`-script (existing): geen aanpassing nodig — alle nieuwe procedures derive `partnerId` van JWT.

**Phase 2 — client**
- `UserMenuChip.test.tsx` (existing): test dat toggle een mutation triggert en de help-tekst zichtbaar is. Forced-note alleen als config het meldt.

**Phase 3 — client**
- `ComposeArea.test.tsx` (existing of nieuw): met effectieve config `'forced'` en `aiOptOut=true` → improve-call wordt NIET getriggerd op send. Met `'forced'` en `aiOptOut=false` → improve-call WEL.

**Phase 4 — client**
- `AdminAi.test.tsx` (existing of nieuw): respect k-drempel; correct gedrag bij `hidden=true`.

**Phase 5 — client**
- `AiDisclosureBanner.test.tsx` (nieuw): toon-eens-per-sessie via localStorage; dismissal werkt.

## Out of scope

- **Per-actie granulariteit** (optie C uit grill-me): werknemer kan niet "translate ja, improve nee" kiezen. Hele toggle is alles-of-niets.
- **Audit-trail van toggle-acties** (decision 6): bewust weggelaten.
- **Backfill van bestaande `userId`-velden naar NULL**: ook bewust weggelaten — `userId` blijft staan op rijen geschreven vóór toggle aan; alleen nieuwe rijen anonimiseren.
- **Cross-side ✨ en auto-translate badges (audit gap G1)**: low-priority polish, kan apart plan.
- **First-touch AI-notice in agent↔expert chat (audit gap G2)**: low-priority; werknemers worden via werkraad-disclosure + banner geïnformeerd.
- **Per-membership rate-limit op partner-niveau na anonimisatie**: nog niet vereist; partner-globaal rate-limit blijft werken.

## Done criteria

- [ ] Schema-migratie draait in CI tegen Docker Postgres zonder fout.
- [ ] `npm test` server: nieuwe opt-out tests groen.
- [ ] `npm test` client: nieuwe toggle + compose tests groen.
- [ ] `scripts/ci.ps1` end-to-end groen.
- [ ] Handmatige verificatie: werknemer zet toggle aan, doet improve-actie, controleer in `ai_usage_log` dat de rij `user_id IS NULL` heeft.
- [ ] Handmatige verificatie: partner met `messageImprovement='forced'` + werknemer met opt-out → bij verzenden geen auto-rewrite.
- [ ] AdminAi pagina toont aggregate; bij testpartner met < 5 werknemers verschijnt "Te kleine groep".
- [ ] WORKS_COUNCIL_DISCLOSURE.md en AI_ACT_AUDIT.md verwijzen naar bestaande feature (zin op te nemen na merge).

## Next step

Bij groen licht: start phase 1 in een werkbranch. Schemamigratie eerst, dan server-tests, dan UI. Geen Docker-restart van server vergeten na elke server-edit (tsx watch is onbetrouwbaar op Windows-bind-mount, zie memory).
