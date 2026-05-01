// server/services/availability/policy.ts
import type { AgentStatus, AvailabilityDeps, DetachResult } from './index.js';

/**
 * Set status with PG-first / Redis-second / broadcast-last atomicity. On
 * Redis-write failure, the PG row is rolled back to whatever the user's
 * prior status was (or the open row is closed if there was no prior state).
 */
export async function runSetStatus(
  deps: AvailabilityDeps,
  args: { userId: string; partnerId: string; status: AgentStatus },
): Promise<void> {
  const now = deps.clock.now();
  const prevStatus = await deps.live.readStatus(args.partnerId, args.userId);
  if (!prevStatus) {
    // No-op: user never identified. Matches today's `setUserStatus` no-op.
    return;
  }

  // 1. PG: open a new row (closes any previous open row).
  await deps.log.openRow({
    userId: args.userId,
    partnerId: args.partnerId,
    status: args.status,
    startedAt: now,
  });

  // 2. Redis: write status.
  try {
    await deps.live.writeStatus(args.partnerId, args.userId, args.status);
  } catch (err) {
    // Roll back the PG row by reopening with the previous status.
    deps.logger?.error(
      { err: err instanceof Error ? err.message : String(err), userId: args.userId },
      '[availability] live.writeStatus failed — rolling back PG row',
    );
    await deps.log.openRow({
      userId: args.userId,
      partnerId: args.partnerId,
      status: prevStatus,
      startedAt: now,
    });
    throw err;
  }

  // 3. Broadcast: support roster updated.
  const roster = (await deps.live.listOnline(args.partnerId))
    .filter((u) => u.role === 'support' && !u.isPlatformOperator)
    .map((u) => ({ userId: u.userId, name: u.name, status: u.status as AgentStatus }));
  deps.broadcast.supportOnline(args.partnerId, roster);
}

/**
 * Attach a socket. On first attach, identity is upserted with initial status
 * 'online'. On reconnect (existing identity), status is preserved. Always
 * clears the offline-at marker (the user has at least one socket again).
 */
export async function runAttach(
  deps: AvailabilityDeps,
  args: {
    userId: string;
    partnerId: string;
    socketId: string;
    role: string;
    name: string;
    isPlatformOperator?: boolean;
  },
): Promise<void> {
  const now = deps.clock.now();
  const isPlatOp = args.isPlatformOperator ?? false;

  // 1. PG: open row only on first attach (no previous identity).
  const prevStatus = await deps.live.readStatus(args.partnerId, args.userId);
  if (!prevStatus) {
    await deps.log.openRow({
      userId: args.userId,
      partnerId: args.partnerId,
      status: 'online',
      startedAt: now,
    });
  }

  // 2. Redis: upsert identity (preserves status if hash exists), attach socket.
  await deps.live.upsertIdentity({
    partnerId: args.partnerId,
    userId: args.userId,
    name: args.name,
    role: args.role,
    isPlatformOperator: isPlatOp,
    initialStatus: 'online',
  });
  await deps.live.attachSocket(args.partnerId, args.userId, args.socketId);
  await deps.live.clearOfflineAt(args.partnerId, args.userId);

  // 3. On reconnect with prior status, reopen the PG row with the preserved
  //    status so the log reflects "online again with their preserved status."
  if (prevStatus) {
    await deps.log.openRow({
      userId: args.userId,
      partnerId: args.partnerId,
      status: prevStatus,
      startedAt: now,
    });
  }

  // 4. Broadcast: support roster + agents list (matches today's auth.ts).
  const isSupport = args.role === 'support' || args.role === 'admin' || isPlatOp;
  if (isSupport) {
    const roster = (await deps.live.listOnline(args.partnerId))
      .filter((u) => u.role === 'support' && !u.isPlatformOperator)
      .map((u) => ({
        userId: u.userId,
        name: u.name,
        status: u.status as AgentStatus,
      }));
    deps.broadcast.supportOnline(args.partnerId, roster);
  }
  if (args.role === 'agent') {
    const ids = (await deps.live.listOnline(args.partnerId))
      .filter((u) => u.role === 'agent')
      .map((u) => u.userId);
    deps.broadcast.agentsOnline(args.partnerId, ids);
  }
}

/**
 * Detach a socket. Only marks offline + closes PG row + broadcasts on the
 * full-offline transition (last socket out). Multi-socket users (e.g. two tabs)
 * see only an internal SREM with no observable change.
 */
export async function runDetach(
  deps: AvailabilityDeps,
  args: { userId: string; partnerId: string; socketId: string },
): Promise<DetachResult> {
  const now = deps.clock.now();

  // Snapshot role before any state changes — we need it for the post-detach broadcast.
  const list = await deps.live.listOnline(args.partnerId);
  const userRow = list.find((u) => u.userId === args.userId);
  const role = userRow?.role ?? null;
  const isPlatOp = userRow?.isPlatformOperator ?? false;

  const { socketCount } = await deps.live.detachSocket(
    args.partnerId,
    args.userId,
    args.socketId,
  );

  if (socketCount > 0) {
    return { removed: false, role };
  }

  // Full-offline transition.
  await deps.live.markOfflineAt(args.partnerId, args.userId, now);
  await deps.log.closeOpenRow({
    userId: args.userId,
    partnerId: args.partnerId,
    endedAt: now,
  });

  if (role === 'support' || role === 'admin' || isPlatOp) {
    const roster = (await deps.live.listOnline(args.partnerId))
      .filter((u) => u.role === 'support' && !u.isPlatformOperator)
      .map((u) => ({
        userId: u.userId,
        name: u.name,
        status: u.status as AgentStatus,
      }));
    deps.broadcast.supportOnline(args.partnerId, roster);
  }
  if (role === 'agent') {
    const ids = (await deps.live.listOnline(args.partnerId))
      .filter((u) => u.role === 'agent')
      .map((u) => u.userId);
    deps.broadcast.agentsOnline(args.partnerId, ids);
  }

  return { removed: true, role };
}
