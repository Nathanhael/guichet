import type { Server } from 'socket.io';

export interface SlaBreachPayload {
  ticketId: string;
  partnerId: string;
  department: string;
  overdueMinutes: number;
}

export interface SlaBreachBroadcaster {
  emitBreach(payload: SlaBreachPayload): void;
}

export const nullBroadcaster: SlaBreachBroadcaster = {
  emitBreach: () => {},
};

export function createSocketIoBroadcaster(io: Server): SlaBreachBroadcaster {
  return {
    emitBreach(payload) {
      io.to(`ticket:${payload.ticketId}`).emit('sla:breach', payload);
    },
  };
}
