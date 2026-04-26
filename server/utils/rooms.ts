/**
 * Centralised socket.io room name generation.
 *
 * Every room template in the codebase MUST use these helpers
 * so that room names are auditable with a single grep for `Rooms.`.
 */
export const Rooms = {
  /** Partner-wide room — all users in this partner (for partner:deactivated, hours:closed, etc.) */
  partner: (partnerId: string) => `partner:${partnerId}` as const,

  /** Staff-only room — support, admin, platform operators (for ticket:created, ticket:assigned) */
  staff: (partnerId: string) => `partner:${partnerId}:staff` as const,

  /** Individual ticket room — only participants */
  ticket: (ticketId: string) => `ticket:${ticketId}` as const,

  /** Read-only preview room — admins watching a ticket without joining as a participant */
  ticketPreview: (ticketId: string) => `ticket:${ticketId}:preview` as const,

  /** Private user room — for kill switches and targeted disconnects */
  user: (userId: string) => `user:${userId}` as const,
} as const;
