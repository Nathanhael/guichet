# Department-Based Ticket Transfer

**Date:** 2026-04-02
**Status:** Approved

## Summary

Replace agent-to-agent ticket transfer with department-based transfer. Support agents can already join/leave chats freely, making person-to-person transfer redundant. Transfer now means "move this ticket to a different department's queue."

## Current Behavior

- Transfer menu lists online support agents by name
- Selecting an agent reassigns `support_id` to that agent
- "Return to queue" clears `support_id` (same department)
- "No other support online" shown when no agents available

## New Behavior

### Transfer Menu

- Lists partner's departments (excluding ticket's current department)
- Optional text input for transfer note (whisper)
- "Return to queue" remains unchanged (same department, unassign)
- "No other support online" fallback removed (irrelevant for dept transfer)

### Client Flow

1. Agent clicks **Transfer** button
2. Dropdown shows departments from `partner.departments` (excluding current)
3. Optional: text input for transfer note (placeholder: "Add context for the next agent...")
4. Agent selects department:
   - If note entered → emit as whisper message first
   - Emit `ticket:transfer` with `{ ticketId, departmentId }`
5. Chat closes for the transferring agent

### Server Flow

1. `ticket:transfer` handler receives `{ ticketId, departmentId }`
2. Validate `departmentId` exists in partner's `departments` JSONB
3. Update ticket: set `department = departmentId`, clear `support_id` and `support_name`
4. Insert system message: "Ticket transferred to [Department Name] by [Agent Name]"
5. Remove all support sockets from ticket room
6. Broadcast `ticket:transferred` with new department info
7. Broadcast updated queue positions for both old and new department

### What Stays

- **Return to queue** — unchanged (same department, clears assignment)
- **Join/Leave** — unchanged (agents freely join/leave via socket events)
- **SLA** — resets naturally when department changes

## Translation Keys

New keys (all three locales: en, fr, nl):
- `transfer_to_department` — label for the transfer section
- `transfer_note_placeholder` — placeholder for optional note input
- `ticket_transferred_to` — system message template

Existing keys already added: `transfer`, `transfer_to`, `return_to_queue`.
Remove: `no_other_support_online` (no longer used).

## Files Affected

### Server
- `server/socket/handlers.ts` — rewrite `ticket:transfer` handler (dept-based, remove agent targeting)
- `server/db/schema.ts` — verify ticket has department field (should already exist)

### Client
- `client/src/components/ChatWindow.tsx` — rewrite transfer menu (dept list, optional note input)
- `client/src/locales/en.ts` — add new keys, remove unused
- `client/src/locales/fr.ts` — add new keys, remove unused
- `client/src/locales/nl.ts` — add new keys, remove unused
