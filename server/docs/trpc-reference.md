# Tessera tRPC API Reference

Auto-generated reference for all tRPC procedures.
Client access: `trpc.<router>.<procedure>`

## Auth Levels

| Level | Description |
|-------|-------------|
| **public** | No authentication required |
| **protected** | Authenticated user (any role) |
| **admin** | Admin or platform operator |
| **platform** | Platform operator with step-up verification |
| **platformBase** | Platform operator (no step-up required) |
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
| `changePassword` | mutation | protected | Change own password. Input: `{ currentPassword, newPassword }`. Validates strength, checks history (last 5), revokes all sessions |

## mfa

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getStatus` | query | protected | Check if MFA is enabled for current user |
| `beginSetup` | mutation | protected | Generate TOTP secret and QR URI |
| `enable` | mutation | protected | Enable MFA with TOTP verification code. Returns 8 recovery codes |
| `disable` | mutation | protected | Disable MFA (requires valid TOTP code) |
| `regenerateRecoveryCodes` | mutation | protected | Generate new recovery codes (requires TOTP verification) |

## partner

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getManifest` | query | admin | Get partner config (logo, industry, departments) |
| `getBusinessHours` | query | protected | Get business hours configuration |
| `updateBusinessHours` | mutation | admin | Update business hours schedule |
| `updateDepartments` | mutation | admin | Update department definitions |
| `listMembers` | query | admin | List partner team members with memberships |
| `addMemberByEmail` | mutation | admin | Add existing user to partner by email |
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
| `updateUser` | mutation | platform | Update global user profile |
| `deactivatePartner` | mutation | platform | Deactivate a partner (blocks logins + tickets) |
| `reactivatePartner` | mutation | platform | Reactivate a deactivated partner |
| `deletePartner` | mutation | platform | Soft-delete a partner |
| `listGlobalUsers` | query | platform | List all users with MFA/lockout status and memberships |
| `inviteUser` | mutation | platform | Invite a new user to a partner |
| `resendInvite` | mutation | platform | Resend invitation email |
| `sendTestEmail` | mutation | platform | Send a test email to verify mail config |
| `disableUserMfa` | mutation | platform | Force-disable MFA for a user (sends notification email) |
| `unlockUser` | mutation | platform | Unlock a locked-out user account |
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

## platformSecurity

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `getStatus` | query | platformBase | Check step-up TOTP status. Auto-satisfied when `REQUIRE_PLATFORM_STEP_UP=false` |
| `beginSetup` | mutation | platformBase | Generate platform TOTP secret for step-up setup |
| `enable` | mutation | platformBase | Enable platform step-up with TOTP verification |
| `verify` | mutation | platformBase | Verify step-up TOTP code (unlocks platform tabs for 15 min) |

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
