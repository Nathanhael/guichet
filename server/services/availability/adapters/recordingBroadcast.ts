// server/services/availability/adapters/recordingBroadcast.ts
import type { BroadcastPort } from '../ports.js';
import type { AgentStatus } from '../types.js';

type Event =
  | { kind: 'support:online'; partnerId: string; roster: { userId: string; name: string; status: AgentStatus }[] }
  | { kind: 'agents:online'; partnerId: string; ids: string[] };

export class RecordingBroadcast implements BroadcastPort {
  public events: Event[] = [];

  supportOnline(partnerId: string, roster: { userId: string; name: string; status: AgentStatus }[]) {
    this.events.push({ kind: 'support:online', partnerId, roster });
  }

  agentsOnline(partnerId: string, ids: string[]) {
    this.events.push({ kind: 'agents:online', partnerId, ids });
  }

  reset() { this.events = []; }
}
