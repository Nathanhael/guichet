## What to build

Document the two-file allowlist in `CLAUDE.md` under the "Multi-Tenancy" key conventions section. Add `scripts/check-trpc-tenant-isolation.mjs` that fails if `partnerId:\s*z\.` appears inside an `.input(` block in any file under `server/trpc/routers/` other than `support.ts` and `platform/**`. Wire it into `scripts/ci.ps1` as a new step after typecheck and before tests.

Source plan: `docs/superpowers/plans/2026-04-24-trpc-tenant-isolation-hardening.md` (Steps 6-8).
Source PRD: `docs/superpowers/specs/2026-04-24-trpc-tenant-isolation-prd.md` (US 4, 5, 7, 18, 19).

## Acceptance criteria

- [ ] `scripts/check-trpc-tenant-isolation.mjs` exists (~25 LOC, Node script)
- [ ] Script scans `server/trpc/routers/**` and flags files with `partnerId:\s*z\.` inside an `.input(` block
- [ ] Allowlist: `support.ts`, `platform/**`
- [ ] Script exits non-zero with file+line on violation; zero otherwise
- [ ] Wired into `scripts/ci.ps1` as a new step after typecheck, before tests
- [ ] `CLAUDE.md` "Multi-Tenancy" section documents: "Platform operators cross tenants only via `platform.*` endpoints or by calling `POST /enter-partner` to mint a JWT with the target `partnerId`. No non-platform endpoint accepts cross-tenant input."
- [ ] `CLAUDE.md` names `support.ts` + `platform/**` as the only allowlisted locations
- [ ] `scripts/ci.ps1 -Skip e2e` passes green with the guard active

## Blocked by

- Blocked by #2
- Blocked by #5
- Blocked by #3
- Blocked by #4
