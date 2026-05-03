// server/services/uploadOwnership.ts
//
// Maps an upload filename → owning partnerId for the `/uploads/<file>` proxy
// gate (`server/app.ts`). Filenames are random UUIDs; the helper joins through
// `messages` (where the URL was first persisted) onto `tickets.partnerId`.
//
// Two columns can hold the URL:
//   • `messages.attachments` JSONB array (modern format, multi-file)
//   • `messages.mediaUrl` (legacy single-image, pre-attachments)
//
// Returns `null` when the filename is not registered in any message — the
// proxy treats that as 404 (no leak about the file's existence elsewhere).
import { eq, or, sql } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { messages, tickets } from '../db/schema.js';

export async function lookupFilePartnerId(filename: string): Promise<string | null> {
  if (!filename) return null;
  const url = `/uploads/${filename}`;
  const containment = JSON.stringify([{ url }]);

  const rows = await db
    .select({ partnerId: tickets.partnerId })
    .from(messages)
    .innerJoin(tickets, eq(messages.ticketId, tickets.id))
    .where(
      or(
        sql`${messages.attachments} @> ${containment}::jsonb`,
        eq(messages.mediaUrl, url),
      ),
    )
    .limit(1);

  return rows[0]?.partnerId ?? null;
}
