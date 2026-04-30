// server/services/moderator/index.ts
import { runPolicy } from './policy.js';
import type { RepetitionPort } from './repetition.js';

export type GuardCode =
  | 'guard_too_short' | 'guard_too_long'
  | 'guard_all_caps_notice' | 'guard_injection'
  | 'guard_offensive' | 'guard_threat' | 'guard_discrimination'
  | 'guard_repetition';

export type ModerationScope = 'message:send' | 'message:edit' | 'ticket:create';

export interface ModerationContext {
  senderId: string;
  partnerId: string;
  scope: ModerationScope;
}

export interface ModerationResult {
  decision: 'pass' | 'block';
  blockingCode: GuardCode | null;
  original: string;
  sanitized: string;
  triggered: GuardCode[];
}

export interface ModerationPort {
  moderate(text: string, ctx: ModerationContext): Promise<ModerationResult>;
}

export interface ModeratorDeps {
  repetition: RepetitionPort;
  clock?: () => Date;
  logger?: { warn: (obj: unknown, msg?: string) => void };
}

export class Moderator implements ModerationPort {
  constructor(private readonly deps: ModeratorDeps) {}

  async moderate(text: string, ctx: ModerationContext): Promise<ModerationResult> {
    return runPolicy(text, ctx, this.deps);
  }
}

export type { RepetitionPort } from './repetition.js';
