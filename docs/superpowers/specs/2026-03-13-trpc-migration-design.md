# tRPC Migration — Design Spec

**Date:** 2026-03-13
**Status:** Approved, pending implementation
**Goal:** Replace raw `fetch`-based REST calls with end-to-end typesafe tRPC procedures, and migrate raw `pool.query()` calls to Drizzle ORM queries. Eliminates manual type syncing between server routes and client, gives React Query caching/loading states for free, and produces a fully type-safe stack from DB → server → client.

## Decisions

- **Monorepo shared package** (`packages/trpc/`) — router type exported from one place, imported by both server and client
- **Keep Express** as HTTP server; tRPC mounts at `/trpc` via the Express adapter
- **Excluded from migration**: `auth` (will be replaced by Entra ID), `uploads` (multipart, incompatible with tRPC)
- **Client**: `@trpc/react-query` + `@tanstack/react-query` — replaces raw `fetch`, adds caching and loading states
- **Migration strategy**: incremental (one route file at a time) + replace raw `pool.query()` / `get()` / `run()` calls with Drizzle query builder as each route is migrated
- **Drizzle**: schema already defined in `server/db/schema.ts`; `db` instance already exported — migrate queries during tRPC work, two birds one stone

## Package Structure

```
packages/
  trpc/
    src/
      trpc.ts           ← initTRPC instance, context type, auth middleware
      router.ts         ← root AppRouter (merges all sub-routers)
      routers/
        tickets.ts
        messages.ts
        stats.ts
        labels.ts
        feedback.ts
        canned-responses.ts
    package.json        ← name: "@i-pxs/trpc", no build step (ts-node / tsx)
```

`packages/trpc/` is a TypeScript-only package. No compilation step — server imports it directly via `tsx`, client imports the type only (`import type { AppRouter }`).

## Server Changes

### Mount point (`server/app.ts`)
```ts
import { appRouter } from '@i-pxs/trpc/router';
import { createExpressMiddleware } from '@trpc/server/adapters/express';

app.use('/trpc', createExpressMiddleware({
  router: appRouter,
  createContext: ({ req }) => ({
    user: req.user ?? null,   // set by existing JWT middleware
    token: req.headers.authorization ?? '',
  }),
}));
```
Existing `/api/*` routes stay mounted and are removed one by one as procedures are added.

### Context & auth (`packages/trpc/src/trpc.ts`)
```ts
const t = initTRPC.context<Context>().create();
export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { user: ctx.user } });
});
```

### Procedures (wrapper pattern + Drizzle)
Each procedure replaces both the Express route handler AND its raw SQL calls:
```ts
// packages/trpc/src/routers/tickets.ts
export const ticketsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    // Before: await query('SELECT * FROM tickets WHERE agent_id = $1', [ctx.user.id])
    return db.select().from(tickets).where(eq(tickets.agentId, ctx.user.id));
  }),
  close: protectedProcedure
    .input(z.object({ ticketId: z.string(), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      await db.update(tickets)
        .set({ status: 'closed', closingNotes: input.notes })
        .where(eq(tickets.id, input.ticketId));
    }),
});
```
Socket handlers (`server/socket/handlers.ts`) also migrate their raw queries to Drizzle — they're not part of tRPC but touched in the same pass.

## Client Changes

### Setup (`client/src/lib/trpc.ts`)
```ts
export const trpc = createTRPCReact<AppRouter>();
export const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: '/trpc' })],
});
```

Wrap app root with `trpc.Provider` + `QueryClientProvider`.

### Usage (replaces raw fetch)
```ts
// Before
const [stats, setStats] = useState(null);
useEffect(() => { fetch('/api/stats').then(r => r.json()).then(setStats) }, []);

// After
const { data: stats, isLoading } = trpc.stats.get.useQuery();
```

Zustand store keeps socket/real-time state. React Query owns server-fetched data.

## Migration Order

1. `labels` — simplest CRUD, good first test
2. `canned-responses` — similar shape
3. `feedback`
4. `messages` — read-only REST (send goes via socket, stays there)
5. `tickets` — most complex, do last
6. `stats` — heavy query, benefits most from React Query caching

Remove the corresponding Express route file after each procedure is verified working.

## Files to Create
- `packages/trpc/package.json`
- `packages/trpc/src/trpc.ts`
- `packages/trpc/src/router.ts`
- `packages/trpc/src/routers/*.ts` (one per route)
- `client/src/lib/trpc.ts`

## Files to Modify
- `package.json` (root) — add workspace config if not present
- `server/package.json` — add `@i-pxs/trpc` workspace dep
- `client/package.json` — add `@trpc/react-query`, `@tanstack/react-query`, `@i-pxs/trpc`
- `server/app.ts` — mount `/trpc` endpoint
- `client/src/main.tsx` — wrap with providers
- `vite.config.ts` — may need path alias for workspace package

## Out of Scope
- `auth` routes (Entra ID migration planned separately)
- `uploads` route (multipart, stays as Express)
- Socket.io real-time events (untouched — only socket handler raw queries migrate to Drizzle)
- tRPC subscriptions (Socket.io handles real-time)
- Server-side rendering
- Drizzle migrations (already managed via drizzle-kit, no changes needed)
