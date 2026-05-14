# Handover

You are reading this because the project is moving to a new primary owner. This document covers everything that is **not** discoverable from the code, the runbooks, or `git log`. Read top to bottom once; treat sections marked **TODO (outgoing owner)** as gaps the previous owner must fill in before sign-off.

---

## 1. Start here

Before opening anything else:

1. Read `CLAUDE.md` in the repo root — the architecture + conventions map.
2. Read `README.md` — the public framing.
3. Skim `docs/` (`ls docs/`) — every runbook has a single clear purpose.
4. Run `scripts/ci.ps1` against a clean clone. Green = your environment matches the previous owner's.

That's roughly 2–3 hours of reading. Don't go deeper into source until that's done — you'll save days.

---

## 2. State of play (as of handover)

| Item | State |
|---|---|
| Branch | `main`, working tree clean |
| Versions | `server@1.0.0`, `client@1.0.0` |
| Open PRs / issues on GitHub | 0 / 0 |
| Test count | 135 server + 60 client = 195 total |
| TODO / FIXME in source | 0 client, 1 server (test-only) |
| Local CI | last green run: 10/10 (~6.5 min) |
| Production hardening | code-level done; see CLAUDE.md `## Production Hardening` |
| Azure trial deployment | running in `rg-guichet-trial`, separate Azure subscription; **trial only, not the pilot target** |
| Pilot at user's employer | **not yet launched** — see §4 for the plan |
| AI features (improve / translate / transcribe / classify / suggest / match_canned) | code-complete, **shipping disabled** (`AI_ENABLED=false`) pending §5 |

---

## 3. Decisions you should know about

Things that look weird until you know why:

| Decision | Why | Where to read |
|---|---|---|
| Drizzle ORM, not Prisma | Smaller abstraction, easier to debug migration drift, ships a Drizzle-only `migrate()` for prod images | `server/db/schema.ts`, `server/drizzle.config.ts` |
| tRPC, not REST (mostly) | End-to-end type safety; one schema definition per procedure | `server/trpc/router.ts` |
| Cookie-only JWT (no `Authorization: Bearer`) | Eliminates the XSS token-theft vector | `server/middleware/auth.ts`, CLAUDE.md `Cookie-Only Auth` |
| Rotating refresh tokens + family-based reuse detection | Replaying a used refresh token revokes the entire family | `server/services/auth/refreshToken.ts` |
| WORM audit chain (SHA-256) | Tamper evidence for compliance; GDPR purge fails closed if chain breaks | `docs/AUDIT_RUNBOOK.md` |
| Field-level AES-GCM encryption for AI provider keys | DB dumps don't leak credentials | `server/services/encryption.ts` |
| No passwords / no MFA tables on `users` | SSO-only by design; emergency = break-glass CLI | `docs/BREAK_GLASS_RUNBOOK.md` |
| Soft Product design tokens (no hex literals in components) | Single source for theming, dark mode, accessibility modes | `docs/SOFT_PRODUCT_DESIGN_SPEC.md`, `client/src/index.css` |
| Multi-tenant guard at CI level | `scripts/check-trpc-tenant-isolation.mjs` blocks non-allowlisted client-supplied `partnerId` | `scripts/ci.ps1` step `tenant-isolation-guard` |
| Per-partner AI verbosity (hash / metadata / full) | Worker-data AI feature with EU AI Act + CCT 39 implications | `docs/AI_ACT_AUDIT.md`, `docs/WORKS_COUNCIL_DISCLOSURE.md` |
| AOAI region target `francecentral` for prod, `swedencentral` for trial | 9/10 trial resources are in francecentral; sweden was a quota workaround for now-deprecated gpt-5 models | `docs/AZURE_CUTOVER_RUNBOOK.md` `AOAI quota requests` |
| AzureBlob storage for uploads (prod) / local disk (dev) | Single `storage.ts` adapter, env-controlled | `server/services/storage.ts` |
| Squash Drizzle migrations only at prod cutover | Dev keeps full history; cutover collapses to `0000` against a fresh DB | `docs/AZURE_CUTOVER_RUNBOOK.md` |

If you find yourself wanting to "fix" any of these — read the linked doc first. Most are load-bearing.

---

## 4. Pilot launch plan (at user's employer)

**Scope**: corporate Azure Entra SSO for identity, everything else local Docker. AI features stay off until §5 clears.

Stages (lead-time critical path is corp IT app registration):

1. Pick the pilot host + URL (e.g. `pilot-guichet.<company>`). Everything downstream needs this.
2. Provision the box: any Linux VM with Docker + Compose, 2 vCPU / 4 GB / 40 GB.
3. TLS cert for the pilot URL (corp CA or Let's Encrypt). Drop into the bundled `lb` service.
4. Request from corp IT: an Entra app registration. Hand them `docs/SSO_SETUP_RUNBOOK.md` §1.1 + the pilot URL. You need back `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`. Typical 1–5 business days.
5. Request from corp IT: one Azure security group per intended partner. Capture the group object ID.
6. Stack up on the pilot host with:
   - `AI_ENABLED=false`
   - `COOKIE_SECURE=true`, `FRONTEND_URL=https://pilot-guichet...`, `CORS_ORIGIN=` same
   - fresh 64-char `JWT_SECRET`
   - `PLATFORM_ADMIN_EMAIL` = the operator's email
   - `AZURE_AD_*` from step 4
   - skip `FIELD_ENCRYPTION_SECRET` (no AI = not required)
7. First login → operator auto-created → create the first partner → map its Azure group via PlatformView → Group Mappings.
8. `npm run db:backup` on cron. Daily. 10-keep retention is built in.

Full Azure-resident production cutover is documented separately in `docs/AZURE_CUTOVER_RUNBOOK.md`. It is **not** the pilot path.

---

## 5. AI / syndicat track (parallel, does not block pilot)

AI features are built but switched off pending two approvals at the partner-employer:

1. **Internal EU AI Act re-check** — walk `docs/AI_ACT_AUDIT.md` with whoever owns compliance / DPO. Confirm or flag deltas for the company's specific deployment context.
2. **Works council consultation (CCT 39 / CCT 81)** — `docs/WORKS_COUNCIL_DISCLOSURE.md` is the template the employer fills in and presents to the syndicat. `docs/PARTNER_PRIVACY_NOTICE_SNIPPET.md` covers the GDPR Art. 88 worker-privacy angle.

When both clear: flip `AI_ENABLED=true`, set `FIELD_ENCRYPTION_SECRET` (64-char hex), configure the AI provider per-partner in admin UI.

Compliance triple-coverage rule: any new `AiAction` must update `AI_ACT_AUDIT.md` + `WORKS_COUNCIL_DISCLOSURE.md` + `PARTNER_PRIVACY_NOTICE_SNIPPET.md` together. Don't ship the code without the doc updates.

---

## 6. In-flight items

**TODO (outgoing owner):** convert mental backlog to GitHub issues, one per item. Suggested labels: `pilot`, `compliance`, `tech-debt`, `feature`.

Until that's done, the only known in-flight tracks are:

- Pilot launch (§4).
- AI / syndicat approvals (§5).
- This handover document — sections 7 + 8 below need outgoing-owner input.

---

## 7. Where things live

| Resource | Location |
|---|---|
| Repo | `D:\Projects_Coding\guichet` (Windows dev box). **TODO (outgoing owner): GitHub repo URL + admin transfer plan.** |
| Cross-project wiki | `D:\Projects_Coding\wiki` — `wiki/index.md` is the catalog. Worth syncing to the new owner. |
| Azure trial subscription | **TODO (outgoing owner): subscription ID + tenant + whether it transfers or gets torn down.** |
| AOAI trial resource | `swedencentral`, deployment name `gpt-4o`. Production target is a separate AOAI resource in `francecentral` — quota request lead time 5–7 days (`docs/AZURE_CUTOVER_RUNBOOK.md`). |
| DB backups | `server/backups/`, gzipped, 10-keep rotation. **TODO (outgoing owner): is there an off-host copy?** |
| Secrets storage today | **TODO (outgoing owner): where the dev `.env` lives, where prod secrets will live (Key Vault? sealed env in repo? other?).** |
| Domain / DNS | **TODO (outgoing owner): registrar + DNS controller for any production hostname.** |
| Local CI runner | `scripts/ci.ps1` — runs typecheck, tenant-isolation guard, lint, audit, tests, migrate, build. |
| Remote CI | None. Pushing to origin does not run anything. All verification is local. |

---

## 8. Stakeholders

**TODO (outgoing owner):** fill these in before sign-off. The new owner needs names + contact + what each person decides.

| Role | Who | Decides what |
|---|---|---|
| Corp IT / Entra owner | | App registration, group mappings |
| Syndicat (works council) contact | | CCT 39 consultation timing + outcome |
| DPO / compliance lead | | EU AI Act re-check, GDPR posture |
| Pilot business sponsor | | Go / no-go on pilot launch, first partner pick |
| Infrastructure owner | | Pilot host, backup destination, TLS cert source |

---

## 9. First two weeks suggested for the new owner

**Week 1 — orientation:**

- Day 1: clone, `docker compose up`, log in locally as the bootstrap platform operator.
- Day 2: read `CLAUDE.md` end-to-end. Then `server/index.ts` and `client/src/App.tsx` as entry points.
- Day 3: read each runbook in `docs/` (10 files; ~3 hours).
- Day 4–5: run `scripts/ci.ps1` until green on your machine. Create a throwaway dev partner, click through every view.

**Week 2 — pilot involvement:**

- Pair with outgoing owner on §4 step 1–3 (host + TLS).
- File the in-flight issues yourself based on conversations.
- If pilot has launched, shadow one live ticket end-to-end.
- Schedule the §5 compliance walk-through with DPO + syndicat contact.

---

## 10. Hard-won lessons (cross-project wiki)

`D:\Projects_Coding\wiki\learnings\` has the post-mortems from earlier incidents. The ones that matter most for Guichet specifically:

- `guichet-prod-readiness-sweep-2026-05-10` — what hardening landed in the Azure-readiness pass.
- `guichet-azure-trial-deploy-gotchas` — quirks of the trial deployment (ACR Tasks blocked, intentional `NODE_ENV=development`, etc).

Sync the wiki to the new owner; some of these patterns are referenced from code comments.

---

## 11. Sign-off checklist

Before the outgoing owner steps away:

- [ ] All TODOs in §6, §7, §8 filled in.
- [ ] GitHub repo admin access transferred.
- [ ] Azure trial subscription decision made (transfer / tear down / keep parallel).
- [ ] Secrets handed over via a method that doesn't leak (1Password share, sealed message, in-person).
- [ ] One live walk-through session with the incoming owner (60–90 min).
- [ ] Incoming owner has run `scripts/ci.ps1` green on their own machine.
- [ ] Incoming owner has logged in to the local stack as a fresh platform operator.
