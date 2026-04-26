/**
 * Private: system / whisper message inserts that run INSIDE the same
 * lifecycle transaction. Mirrors the public-but-now-deprecated helpers in
 * `services/systemMessage.ts`, except every write goes through `tx`, so a
 * failure rolls back the whole lifecycle event.
 *
 * Sender-info denormalization (`isExternal`, `lang`, `role`) lives here so
 * call sites can't construct half-built whisper rows by reaching into the
 * messages table directly.
 */
import crypto from 'node:crypto';

import { messages } from '../../db/schema.js';

interface BaseMessageArgs {
  ticketId: string;
}

interface SystemMessageArgs extends BaseMessageArgs {
  text: string;
}

interface WhisperMessageArgs extends BaseMessageArgs {
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  senderIsExternal: boolean;
  text: string;
}

/** Insert a system-attributed message (never bears a GUEST badge). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function insertSystemMessageTx(tx: any, args: SystemMessageArgs): Promise<{ id: string; createdAt: string }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await tx.insert(messages).values({
    id,
    ticketId: args.ticketId,
    senderId: '__system__',
    senderName: 'System',
    senderRole: 'admin',
    senderLang: 'en',
    senderIsExternal: false,
    text: args.text,
    whisper: 0,
    system: 1,
    createdAt: now,
    reactions: {},
  });
  return { id, createdAt: now };
}

/** Insert a staff-only whisper message (used by transfers, in later PRs). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function insertWhisperMessageTx(tx: any, args: WhisperMessageArgs): Promise<{ id: string; createdAt: string }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await tx.insert(messages).values({
    id,
    ticketId: args.ticketId,
    senderId: args.senderId,
    senderName: args.senderName,
    senderRole: args.senderRole,
    senderLang: args.senderLang,
    senderIsExternal: args.senderIsExternal,
    text: args.text,
    whisper: 1,
    system: 0,
    createdAt: now,
    reactions: {},
  });
  return { id, createdAt: now };
}
