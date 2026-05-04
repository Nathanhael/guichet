# Guichet tRPC API Reference

Reference for all tRPC procedures (17 routers).
Client access: `trpc.<router>.<procedure>`

## Auth Levels

| Level | Description |
|-------|-------------|
| **public** | No authentication required |
| **protected** | Authenticated user (any role) |
| **admin** | Admin or platform operator |
| **platform** | Platform operator |
| **role(...)** | Specific roles required (platform operators bypass) |

---

## label

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | protected | List labels for current partner |
| `create` | mutation | admin | Create a new label |
| `delete` | mutation | admin | Delete a label by ID |

## ticket

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | protected | List tickets with cursor-based pagination. Input: `{ status?, dept?, search?, limit?, cursor? }`. Returns `{ tickets, nextCursor }` |
| `getById` | query | protected | Get single ticket by ID |

## message

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | protected | List messages for a ticket |
| `search` | query | role(support, admin) | Full-text search across message content. Input: `{ query, partnerId }` |

## cannedResponse

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | role(support, admin) | List canned responses for current partner (with optional category filter) |
| `create` | mutation | admin | Create a canned response. Input: `{ title, body, shortcut?, category? }` |
| `update` | mutation | admin | Update a canned response. Input: `{ id, title?, body?, shortcut?, category? }` |
| `delete` | mutation | admin | Delete a canned response by ID |

## presence

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getOnlineStatus` | query | protected | Get online/offline status for users |
| `setStatus` | mutation | protected | Update own presence status |

## feedback

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | admin | List feedback entries for partner |
| `create` | mutation | protected | Submit feedback |
| `markTreated` | mutation | admin | Mark feedback as treated |

## rating

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | role(admin, support) | List ticket ratings for partner |

## stats

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getGlobalStats` | query | role(admin, support) | Get dashboard statistics |

## user

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | platform | List all users (platform-wide) |
| `demoList` | query | public | List demo users (only when DEMO_MODE=true) |
| `revokeSessions` | mutation | platform | Force sign-out all sessions for a user. Input: `{ userId }` |

## partner

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getManifest` | query | admin | Get partner config (logo, industry, departments) |
| `getBusinessHours` | query | protected | Get business hours configuration |
| `updateBusinessHours` | mutation | admin | Update business hours schedule |
| `updateDepartments` | mutation | admin | Update department definitions |
| `listMembers` | query | admin | List partner team members with memberships |
| `inviteExternalUser` | mutation | admin | Invite new external user to partner |
| `updateMember` | mutation | admin | Update member role/departments |
| `removeMember` | mutation | admin | Remove member from partner |

## alerts

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | role(admin) | List active alerts |
| `acknowledge` | mutation | role(admin) | Acknowledge an alert |
| `resolve` | mutation | role(admin) | Resolve an alert |

## platform

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getSystemHealth` | query | platform | System health metrics (DB, Redis, uptime) |
| `listPartners` | query | platform | List all tenant organizations |
| `createPartner` | mutation | platform | Create a new partner/tenant |
| `updatePartner` | mutation | platform | Update partner settings |
| `deactivatePartner` | mutation | platform | Deactivate a partner (blocks logins + tickets) |
| `reactivatePartner` | mutation | platform | Reactivate a deactivated partner |
| `deletePartner` | mutation | platform | Soft-delete a partner |
| `listGlobalUsers` | query | platform | List all users with memberships |
| `inviteUser` | mutation | platform | Invite a new user to a partner |
| `deleteUser` | mutation | platform | Soft-delete a user |
| `removeMembership` | mutation | platform | Remove a user's membership from a partner |
| `updateMembership` | mutation | platform | Update a user's membership role/departments |
| `getAuditLog` | query | platform | Query audit log with filters and cursor pagination |
| `exportAuditLog` | query | platform | Export audit log as downloadable data |
| `getMailConfig` | query | platform | Get current mail provider configuration |
| `updateMailConfig` | mutation | platform | Update mail provider settings |
| `listGroupMappings` | query | platform | List Azure AD group-to-role mappings |
| `addGroupMapping` | mutation | platform | Add Azure AD group mapping |
| `updateGroupMapping` | mutation | platform | Update Azure AD group mapping |
| `removeGroupMapping` | mutation | platform | Remove Azure AD group mapping |
| `getArchivedAuditLog` | query | platform | Query WORM audit archive with cursor pagination |
| `verifyAuditChain` | query | platform | Verify SHA-256 hash chain integrity |
| `runArchive` | mutation | platform | Manually trigger audit + ticket archival |
| `getArchivedTickets` | query | platform | Query archived tickets with cursor pagination |

## ai

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `improveMessage` | mutation | protected | Rewrite a message for clarity and professionalism |
| `translateMessage` | mutation | protected | Translate a message to a target language (nl/en/fr) |
| `summarizeChat` | mutation | role(support,admin) | Summarize a ticket's chat conversation (Redis-cached) |

## kb

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | protected | List KB articles for the current partner, with optional filters |
| `search` | query | protected | Full-text keyword search across article title and body |
| `aiSearch` | query | protected | AI-powered question answering with article ranking |
| `getById` | query | protected | Get a single KB article by ID |
| `create` | mutation | admin | Create a new KB article |
| `update` | mutation | admin | Update an existing KB article |
| `delete` | mutation | admin | Delete a KB article |

## webhook

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | admin | List all webhooks for the current partner |
| `create` | mutation | admin | Create a new webhook endpoint with SSRF-validated URL |
| `update` | mutation | admin | Update a webhook's URL, events, description, or active status |
| `regenerateSecret` | mutation | admin | Regenerate the HMAC signing secret for a webhook |
| `delete` | mutation | admin | Delete a webhook |
| `logs` | query | admin | Get recent delivery logs for a webhook |
| `test` | mutation | admin | Test-fire a webhook with a sample payload |

## savedView

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `list` | query | protected | List saved views for the current user and partner |
| `create` | mutation | protected | Create a saved ticket queue view with filter criteria (max 20) |
| `update` | mutation | protected | Update a saved view's name, filters, or default status |
| `delete` | mutation | protected | Delete a saved view |

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
- `FORBIDDEN` — Insufficient permissions
- `NOT_FOUND` — Resource not found
- `BAD_REQUEST` — Invalid input or business rule violation

## Real-Time Events (Socket.io)

Not covered here — see `server/socket/handlers.ts` for WebSocket event documentation.
