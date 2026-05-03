# Spec: Uploads tenant isolation + EXIF strip on images

**Date:** 2026-05-03
**Status:** Draft — pre-prod hardening
**Owner:** TBD
**Related code:** `server/routes/uploads.ts`, `server/services/storage.ts`, `server/app.ts:285-320`

## Problem Statement

Two privacy / security gaps in the file-upload pipeline surfaced during the pre-prod review on 2026-05-03:

### Gap 1 — Cross-tenant file access (HIGH)

The proxy at `app.ts:285-320` (`app.use('/uploads', ...)`) gates `GET /uploads/<filename>` on a single check: a valid `guichet_token` JWT cookie. **It does NOT check that the requested file belongs to the caller's partner.** Filenames are random UUIDs (so guessing is practically impossible), but the file URL surfaces in client-side state, browser history, and any place a message body is rendered for an internal viewer. If an attacker captures another partner's upload URL — through accidental sharing, log inspection, or a compromised support session — they can read the file as long as they hold any valid Guichet JWT, regardless of which partner that JWT belongs to.

The Azure blob container is private (`storage.ts:103`), so the issue is the proxy, not the backend. The proxy is the only access path; tightening it closes the gap.

### Gap 2 — EXIF metadata leaks on uploaded images (MEDIUM)

JPEG/PNG/WebP uploads keep their EXIF metadata. Smartphones routinely embed:

- **GPS lat/lng** of the photo location (the largest concern — leaks the agent's real-world position)
- Camera make/model + serial number
- Timestamps independent of the file mtime
- Editing software fingerprint
- Author / copyright fields populated by phone OS

In a helpdesk context, an agent submitting a screenshot of an invoice from their phone leaks GPS coordinates to support staff (and later to anyone with file access — see Gap 1). EXIF strip should be unconditional on the upload path; client trust is not a substitute.

## Solution

### Fix A — Per-message tenant ownership check on the `/uploads` proxy

Extend the proxy middleware to perform a constant-time DB lookup keyed on the requested filename, then verify the resolved row's `partnerId` matches the caller's JWT `partnerId`. The lookup uses a denormalized `messages.attachments` JSONB index (or a sibling `uploads` table — see Design Decisions) to map filename → ownership in a single indexed query.

Behaviour:

- Filename not found in any message: 404 (current behaviour preserved).
- Filename found in a message belonging to a *different* partner than the caller: 403 (new — was 200 + content).
- Filename found in a message belonging to the caller's partner: 200 + content (current behaviour preserved).
- Platform operator JWTs are exempt: a platform operator entered into the partner sees files for that partner only via the same gate, but cross-partner reads via `platform.*` endpoints get a separate exception (see Open Questions).

### Fix B — Strip EXIF on every image upload via `sharp`

In `routes/uploads.ts`, between file-type validation and `storage.upload(...)`, pipe image buffers through `sharp(buffer).toBuffer()`. Sharp's default re-encode drops all metadata (EXIF, ICC, XMP, IPTC); the resulting buffer is metadata-clean. Non-image MIME types (PDF, Office, CSV, plain text) skip the sharp pipeline — they don't carry GPS metadata, and re-encoding office docs would corrupt them.

Optional knob: `sharp(buffer).resize({ width: 2000, withoutEnlargement: true }).toBuffer()` to cap image dimensions while we're already re-encoding. Helpdesk screenshots are small; 4K phone photos buy nothing for support legibility and inflate storage cost. Default-on at width=2000, configurable via an env var if any partner objects.

## Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Tenant check via DB lookup, not URL signing | Signed URLs introduce TTL bookkeeping, revocation gaps, and a second auth path. The proxy already runs auth-check per request; piggybacking the partner check on the same request keeps one source of truth. |
| D2 | Use existing `messages.attachments` JSONB + add an index, NOT a new `uploads` table | Migration cost is one `CREATE INDEX` instead of a new table + dual-write. Filename → message lookup hits the index. |
| D3 | EXIF strip via `sharp` re-encode, NOT a metadata-aware library like `piexifjs` | Sharp is already the de facto Node image lib (compiled native, fast). Re-encode strips everything in one step + lets us resize-cap in the same pass. Trade-off: ~50-200 ms of re-encode latency per image upload. Acceptable on a 5 MB cap. |
| D4 | Skip strip for non-image types | PDFs and Office docs CAN carry metadata too, but extracting/cleaning it requires per-format libraries. Not in scope for this spec; track as follow-up. |
| D5 | Apply the proxy gate before any partial cache hit | Cache headers are `private, max-age=3600` — browser MAY revalidate. The check fires on every fresh request; cached responses on the client side are scoped to that browser session, which is acceptable. |
| D6 | Platform operators see files via partner JWT, not platform JWT | Operators using `/enter-partner` already mint a partner-scoped JWT. The proxy treats them as that partner. No special operator branch. Cross-partner access from `PlatformView` admin/audit/archive UI uses dedicated endpoints (`platform.*`) that resolve files server-side — those bypass `/uploads/` entirely. |

## User Stories

1. As an Acme support agent, when I open a file URL from an Acme ticket, I see the file. **(Existing — no regression)**
2. As an Acme support agent, when I paste a file URL stolen from a Partner B ticket into my browser, I get **403 Forbidden**. **(New — Fix A)**
3. As a Partner B agent who legitimately holds a JWT, the same Partner-A URL gets me **403 Forbidden**, not 200 + leaked data. **(New — Fix A)**
4. As an unauthenticated visitor, I get **401 Unauthorized**, same as today. **(Existing — no regression)**
5. As an attacker who guessed a UUID, I either guess a non-existent one (404) or a real one belonging to another tenant (403). **(New — Fix A)**
6. As a platform operator inside `PlatformView` archive UI, file access flows through `platform.*` endpoints which already enforce cross-partner reads — those keep working. **(Existing — no regression)**
7. As an agent uploading a phone photo with embedded GPS lat/lng, my coordinates are stripped on the server before the file lands in storage. **(New — Fix B)**
8. As a support staff member viewing the same image, I see no GPS pin in EXIF tools (`exiftool`, `exifr`). **(New — Fix B)**
9. As an agent uploading a 4032×3024 phone photo, the stored image is downscaled to 2000×1500 (or whatever ratio preserves aspect at 2000 wide). **(New — Fix B optional knob)**
10. As an agent uploading a PDF or Excel sheet, the file passes through unchanged. Sharp is not applied. **(Existing — no regression)**
11. As an automated test runner, I have a server test proving the proxy returns 403 for a foreign-tenant file URL even with a valid JWT. **(New — regression coverage for Fix A)**
12. As an automated test runner, I have an upload test proving an EXIF-laden JPEG comes out clean from `storage.upload(...)`. **(New — regression coverage for Fix B)**

## Implementation Plan

### Slice 1 — DB index + filename→message lookup helper (Fix A foundation)

- New migration `00NN_add_attachments_filename_index.sql`: GIN index on `messages.attachments` (or a functional index on the URL field — see Open Questions for which works best with our filter pattern).
- New helper `server/services/uploadOwnership.ts` exporting `lookupFilePartnerId(filename: string): Promise<string | null>`.
- Unit test: known filename in fixture → returns expected partnerId; unknown → null.

### Slice 2 — Wire ownership check into `/uploads` proxy (Fix A behaviour)

- In `app.ts:285-320`, after JWT verify + path normalize, call `lookupFilePartnerId(filePath)`.
  - `null` → 404 (file not registered in any message — same as "not found").
  - `partnerId !== ctx.user.partnerId` → 403.
  - Match → continue to `storage.read(...)`.
- Server test: 3 cases (own partner = 200, other partner = 403, missing = 404).

### Slice 3 — Sharp dependency + EXIF strip on image uploads (Fix B)

- `npm install sharp` in server.
- In `routes/uploads.ts`, after `fileTypeFromBuffer` validation, branch on mime:
  - `image/png | image/jpeg | image/webp` → `sharp(buffer).toBuffer()` (or `.resize({ width: 2000, withoutEnlargement: true }).toBuffer()` if D5 stays default-on).
  - other mimes → pass through unchanged.
- Apply the same pipeline in both `/uploads` (single) and `/uploads/multi` routes.

### Slice 4 — Tests (Fix B)

- Unit test: feed a JPEG with known EXIF GPS through the upload handler → assert the stored buffer has no `GPS*` tags (use `exifr` in the test to verify).
- Unit test: feed a PDF → assert byte-for-byte equality (no sharp pipeline ran).
- Optional integration test: upload via Playwright + verify `read()` returns metadata-clean output.

### Slice 5 — Documentation

- Update `docs/TECHNICAL.md` § "8. Uploads" with the new ownership gate + EXIF strip behaviour.
- Wiki page: `learnings/exif-strip-server-side-required` — cross-project lever (any helpdesk app accepting phone photos has this gap).
- Memory: short note in `nginx_permissions_policy_self.md` cross-link OR a new `uploads_security_baseline.md`.

## Tests

- 3 server unit tests for ownership gate (own / other / missing).
- 2 server unit tests for EXIF strip (image stripped / non-image untouched).
- 1 e2e test (optional) for end-to-end upload-then-fetch with EXIF assertions.

## Migration / Rollout

| Step | Order |
|---|---|
| Slice 1 (index + helper) | 1 — non-breaking, additive |
| Slice 3 (sharp + strip) | 2 — non-breaking; new uploads strip metadata, old uploads keep theirs (acceptable per data minimization principle going forward) |
| Slice 2 (proxy gate) | 3 — **breaking** for any in-the-wild URL that points at a file not yet registered in `messages.attachments`. Verify the migration check by querying for orphan filenames before deploy: `SELECT filename FROM uploads_index WHERE message_id IS NULL`. |
| Slice 4 (tests) | Parallel with each slice |
| Slice 5 (docs) | After all green |

Optional: feature-flag the proxy gate for one release behind `ENFORCE_UPLOAD_TENANT_GATE` env (default false), promote to default-on in the next release. Lets us watch the 403 rate before fully enforcing.

## Open Questions

1. **Index shape:** GIN on the JSONB column vs functional index on the unfurled `attachments[*].url`? GIN is general-purpose; functional is faster for our exact query but locks us into one access pattern. **Recommend:** start with GIN; switch to functional only if the lookup shows up in slow-query logs.
2. **Backfill:** existing files in storage already lack a tenant association beyond what the message references. Slice 2's gate uses `messages.attachments` directly — no backfill needed. Confirm.
3. **Legacy `mediaUrl`:** older messages used `mediaUrl` (single-image) before `attachments` array. The lookup helper must check both columns. Add to the helper.
4. **Client behaviour on 403:** image bubbles currently render `<img src="/uploads/...">` and rely on browser to handle 404. Need to confirm a 403 doesn't break the layout — probably renders a broken-image icon. Acceptable for the rare attack-path scenario.
5. **HEIC support:** out of scope for this spec; HEIC is not in `UPLOAD_ALLOWED_TYPES` today. If added later, sharp handles HEIC if compiled with `libheif`.
6. **Document metadata (PDF/Office):** out of scope for this spec; track as follow-up `2026-XX-XX-document-metadata-strip.md`.

## Estimate

| Slice | Tijd |
|---|---|
| 1 — DB helper | 30 min |
| 2 — Proxy gate | 30 min |
| 3 — Sharp strip | 25 min |
| 4 — Tests (5 unit + 1 e2e) | 45 min |
| 5 — Docs + wiki + memory | 20 min |
| **Total** | **~2.5 h** |

## Acceptance Criteria

- [ ] Server tsc + lint clean.
- [ ] All new unit tests pass.
- [ ] Existing server test suite (1179+) still passes.
- [ ] Manual smoke test: upload an image with known EXIF GPS via Postman, fetch it back, run `exifr` — no GPS tags.
- [ ] Manual smoke test: log in as Acme support, paste a Partner B file URL → 403.
- [ ] No client-side regression in `AttachmentGrid` rendering or lightbox.
