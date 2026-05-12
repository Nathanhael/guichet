# Guichet tRPC API Reference

Reference for all tRPC procedures (18 routers).

> **Live reference is canonical.** A dynamically-generated reference is served at `/api/v1/trpc-reference` and reflects the running build. This file is a stable, hand-curated overview — when in doubt, trust the live page or `server/trpc/router.ts` + the per-router files in `server/trpc/routers/`.

Client access: `trpc.<router>.<procedure>`

## Auth Levels

| Level | Description |
|-------|-------------|
| **public** | No authentication required |
| **protected** | Authenticated user (any role) |
| **partnerScoped** | Authenticated + a non-null `partnerId` resolved on the JWT |
| **partnerAdmin** | `partnerScoped` + admin / platform-operator role |
| **admin** | Admin or platform operator (no partner-scope guarantee) |
| **platform** | Platform operator |
| **role(...)** / **partnerRole(...)** | Specific roles required (platform operators bypass) |

---

## status

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getTeamStatus` | query | partnerScoped | Per-partner agent online/away status |
| `getAgentStats` | query | partnerAdmin | Time-in-status stats for a single agent |
| `getTeamStats` | query | partnerAdmin | Aggregated time-in-status stats for the partner team |

## ai

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `improveMessage` | mutation | partnerScoped | Rewrite a message for clarity (role-aware: agent / support) |
| `translateMessage` | mutation | partnerScoped | Translate a message to a target language (nl/en/fr) |
| `healthCheck` | query | partnerAdmin | Probe the configured AI provider; surfaces connectivity / quota state |
| `markImproveResult` | mutation | partnerScoped | Annotate an `ai_usage_log` row with whether the user kept or reverted the rewrite |
| `submitFeedback` | mutation | partnerScoped | Submit thumbs feedback on an AI result (writes `ai_feedback`) |

## cannedResponse

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | partnerScoped (role: support, admin) | List canned responses (with optional category filter) |
| `getForPicker` | query | partnerScoped (role: support, admin) | Locale-aware shape for the chat picker |
| `create` | mutation | partnerAdmin | Create a canned response |
| `update` | mutation | partnerAdmin | Update a canned response |
| `delete` | mutation | partnerAdmin | Delete a canned response |
| `regenerate` | mutation | partnerAdmin | Regenerate AI translations for a canned response |
| `backfillUntranslated` | mutation | partnerAdmin | Bulk-backfill missing translations across the canned-response set |

## kb

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | partnerScoped | List KB articles for the current partner (gated by the `knowledge_base` feature flag) |
| `search` | query | partnerScoped | Full-text keyword search across article title and body |
| `aiSearch` | query | partnerScoped | AI-powered question answering with article ranking |
| `getById` | query | partnerScoped | Get a single KB article by ID |
| `create` | mutation | partnerAdmin | Create a new KB article |
| `update` | mutation | partnerAdmin | Update an existing KB article |
| `delete` | mutation | partnerAdmin | Delete a KB article |

## label

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | partnerScoped | List labels for current partner |
| `create` | mutation | partnerAdmin | Create a new label |
| `update` | mutation | partnerAdmin | Update a label |
| `delete` | mutation | partnerAdmin | Delete a label by ID |

## ticket

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | partnerScoped | List tickets with cursor-based pagination. Input: `{ status?, dept?, search?, limit?, cursor? }`. Returns `{ tickets, nextCursor }` |
| `getById` | query | partnerScoped | Get single ticket by ID |

## message

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | partnerScoped | List messages for a ticket |
| `search` | query | partnerRole(support, admin) | Full-text search across message content |

## presence

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getOnlineStatus` | query | partnerScoped | Get online/offline status for users |
| `setStatus` | mutation | protected | Update own presence status |

## feedback

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | adminProcedure | List feedback entries for partner |
| `create` | mutation | protected | Submit feedback |
| `markTreated` | mutation | adminProcedure | Mark feedback as treated |

## rating

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | role(admin, support) | List ticket ratings for partner |
| `getStaffRatings` | query | role(admin, support) | Per-staff CSAT breakdown with date filtering |
| `getAnalytics` | query | role(admin, support) | Aggregate CSAT metrics for the dashboard |

## savedView

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | protected | List saved views for the current user and partner |
| `create` | mutation | protected | Create a saved ticket queue view with filter criteria (max 20) |
| `update` | mutation | protected | Update a saved view's name, filters, or default status |
| `delete` | mutation | protected | Delete a saved view |

## support

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getStaffingByLanguage` | query | partnerRole(support, admin) | Per-language coverage signal for the queue sidebar |

## dashboard

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getScorecard` | query | partnerAdmin | KPI scorecard tile data (volume, response, resolution, CSAT) |
| `getDeptBreakdown` | query | partnerAdmin | Per-department breakdown table |
| `getStaffBreakdown` | query | partnerAdmin | Per-staff breakdown table |
| `getStaffingHeatmap` | query | partnerAdmin | Hour × weekday heatmap of agent coverage vs ticket volume |
| `getTrends` | query | partnerAdmin | Time-series trends (volume, response, resolution, CSAT) |
| `getOnboardingState` | query | partnerAdmin | Onboarding-mode payload when the partner has no traffic yet |

## user

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `me` | query | protected | Authenticated user's identity, memberships, and preferences |
| `list` | query | platform | List all users (platform-wide) |
| `revokeSessions` | mutation | platform | Force sign-out all sessions + refresh-token families for a user |
| `getLocaleInfo` | query | protected | Resolve current locale + supported locales |
| `setLocale` | mutation | protected | Persist the user's preferred locale |
| `updateAccessibilityPrefs` | mutation | protected | Persist accessibility prefs (dyslexic / monochrome / reduced motion / etc.) |

## platform

Top-level partner / user / archive ops:

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getSystemHealth` | query | platform | System health metrics + tripwires (chain broken / stale, SLA breach burst, GDPR purge missing/failed, DB / Redis liveness) |
| `listPartners` | query | platform | List all tenant organizations |
| `createPartner` | mutation | platform | Create a new partner/tenant |
| `updatePartner` | mutation | platform | Update partner settings |
| `deactivatePartner` | mutation | platform | Deactivate a partner (blocks logins + tickets) |
| `reactivatePartner` | mutation | platform | Reactivate a deactivated partner |
| `deletePartner` | mutation | platform | Soft-delete a partner |
| `listGlobalUsers` | query | platform | List all users with memberships |
| `listGroupMappings` | query | platform | List Azure AD group-to-role mappings |
| `addGroupMapping` | mutation | platform | Add Azure AD group mapping |
| `updateGroupMapping` | mutation | platform | Update Azure AD group mapping |
| `removeGroupMapping` | mutation | platform | Remove Azure AD group mapping |
| `getArchivedAuditLog` | query | platform | Query WORM audit archive with cursor pagination |
| `getArchivedTickets` | query | platform | Query archived tickets with cursor pagination |
| `runArchive` | mutation | platform | Manually trigger audit + ticket archival |

Audit subroutes (under `platform.*`):

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getAuditLog` | query | platform | Multi-axis filtered audit log (cursor pagination) |
| `exportAuditLog` | query | platform | Export filtered audit log as CSV-ready data |
| `listActions` | query | platform | Distinct audit-action values for the filter dropdown |
| `listTargetTypes` | query | platform | Distinct target-type values for the filter dropdown |
| `verifyAuditChain` | mutation | platform | Verify SHA-256 hash chain integrity (rate-limited; runs through `chainVerifySchedule.runChainVerify`) |
| `getLastChainVerify` | query | platform | Most recent verify result for the Health page |
| `getChainVerifyHistory` | query | platform | Verify-run history table for compliance attestation export |
| `getCrossPartnerActivity` | query | platform | Per-partner event totals + last-event timestamp for the rollup panel |

AI security defaults:

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getAiSecurityDefaults` | query | platform | Platform-wide defaults for PII redaction + audit verbosity |
| `setAiSecurityDefaults` | mutation | platform | Update platform-wide AI security defaults |

## partner

Composed from `partner/{config, members, audit}` and re-exported flat (no `partner.config.*` nesting; only `partner.audit.*` is namespaced).

Config:

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getManifest` | query | partnerScoped | Per-partner manifest (departments, AI features, dashboard config, etc.) |
| `getAiConfig` | query | partnerAdmin | Resolved AI config for the partner (provider, key reference, features) |
| `getBusinessHours` | query | partnerScoped | Get business hours configuration |
| `updateBusinessHours` | mutation | partnerAdmin | Update business hours schedule |
| `updateDepartments` | mutation | partnerAdmin | Update department definitions |
| `updateDashboardConfig` | mutation | partnerAdmin | Update dashboard staffing-fit thresholds and other partner-scoped dashboard knobs |
| `updateDepartmentSla` | mutation | partnerAdmin | Update first-response SLA per department |
| `getAiCustomization` | query | partnerAdmin | Get per-partner AI prompt overrides |
| `updateAiCustomization` | mutation | partnerAdmin | Update per-partner AI prompt overrides |

Members:

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `listMembers` | query | partnerAdmin | Roster for partner-side admin views |
| `listAdmins` | query | partnerAdmin | Internal-only admin roster |
| `memberStats` | query | partnerAdmin | Per-member aggregate stats for the team panel |
| `updateMemberDepartments` | mutation | partnerAdmin | Update a member's department visibility (admin-only knob; surviving member-side mutation) |

Audit (`partner.audit.*`):

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `listActions` | query | partnerAdmin | Distinct audit-action values, partner-scoped |
| `listTargetTypes` | query | partnerAdmin | Distinct target-type values, partner-scoped |
| `getAuditLog` | query | partnerAdmin | Partner-scoped audit log |
| `getForTicket` | query | partnerAdmin | Per-ticket audit drawer feed |
| `exportAuditLog` | query | partnerAdmin | Partner-scoped audit log CSV export |

## linkPreview

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `fetchForCompose` | query | protected | Resolve OpenGraph metadata for a URL pasted into the compose area |

## sla

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getTicketState` | query | partnerScoped | Per-ticket SLA state (elapsed, target, breach status) for the chat header pill |
| `listBreaches` | query | partnerAdmin | Recent SLA breaches for the partner |

---

## Pagination Pattern

Cursor-based keyset pagination is used for lists that can grow large:

```typescript
// Request
{ limit: 50, cursor?: "2026-03-24T12:00:00.000Z|abc-123" }

// Response
{ items: [...], nextCursor?: "2026-03-24T11:30:00.000Z|def-456" }
```

- `cursor` format: `createdAt|id` composite
- Fetch `limit + 1` rows, pop last to detect `hasMore`
- `nextCursor` is empty string when no more results

## Error Handling

All procedures throw `TRPCError` with standard codes:
- `UNAUTHORIZED` — Not authenticated
- `FORBIDDEN` — Insufficient permissions (role gate, partner scope, capability check)
- `NOT_FOUND` — Resource not found
- `BAD_REQUEST` — Invalid input or business rule violation

## Real-Time Events (Socket.io)

Not covered here — see `server/socket/handlers.ts` and the per-handler files in `server/socket/handlers/` for WebSocket event documentation.
