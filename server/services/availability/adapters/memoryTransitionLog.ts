// server/services/availability/adapters/memoryTransitionLog.ts
import type { TransitionLogPort } from '../ports.js';
import type { AgentStatus, DailyStats } from '../types.js';

interface Row {
  id: number;
  userId: string;
  partnerId: string;
  status: AgentStatus;
  startedAt: Date;
  endedAt: Date | null;
  duration: number | null;
}

export class MemoryTransitionLog implements TransitionLogPort {
  public rows: Row[] = [];
  private nextId = 1;
  public failNextWrite = false;

  async closeOpenRow(input: { userId: string; partnerId: string; endedAt: Date }) {
    const open = this.rows.find(r => r.userId === input.userId && r.partnerId === input.partnerId && r.endedAt === null);
    if (!open) return;
    open.endedAt = input.endedAt;
    open.duration = Math.round((input.endedAt.getTime() - open.startedAt.getTime()) / 1000);
  }

  async openRow(input: { userId: string; partnerId: string; status: AgentStatus; startedAt: Date }) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('memory-transition-log: simulated failure'); }
    this.rows.push({
      id: this.nextId++,
      userId: input.userId,
      partnerId: input.partnerId,
      status: input.status,
      startedAt: input.startedAt,
      endedAt: null,
      duration: null,
    });
  }

  async closeAndOpen(input: { userId: string; partnerId: string; nextStatus: AgentStatus; at: Date }) {
    await this.closeOpenRow({ userId: input.userId, partnerId: input.partnerId, endedAt: input.at });
    await this.openRow({ userId: input.userId, partnerId: input.partnerId, status: input.nextStatus, startedAt: input.at });
  }

  async rollbackTransition(input: { userId: string; partnerId: string; at: Date }) {
    // Drop the row we just opened (startedAt === at, endedAt === null).
    const newIdx = this.rows.findIndex(r =>
      r.userId === input.userId
      && r.partnerId === input.partnerId
      && r.startedAt.getTime() === input.at.getTime()
      && r.endedAt === null);
    if (newIdx >= 0) this.rows.splice(newIdx, 1);
    // Reopen the prior row that closeAndOpen closed (endedAt === at).
    const prior = this.rows.find(r =>
      r.userId === input.userId
      && r.partnerId === input.partnerId
      && r.endedAt?.getTime() === input.at.getTime());
    if (prior) {
      prior.endedAt = null;
      prior.duration = null;
    }
  }

  async rollupDay(_partnerId: string, _dateStr: string) {
    // Stub: returns 0 rows. Adapter-level test exercises the real rollup.
    return { rowsWritten: 0 };
  }

  async agentDaily(_userId: string, _partnerId: string, _fromDate: string, _toDate: string): Promise<DailyStats[]> {
    return [];
  }

  async teamDaily(_partnerId: string, _fromDate: string, _toDate: string): Promise<DailyStats[]> {
    return [];
  }
}
