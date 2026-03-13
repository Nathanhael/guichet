# tRPC Migration — Design Spec

**Date:** 2026-03-13
**Status:** Approved, pending implementation
**Goal:** Replace raw `fetch`-based REST calls with end-to-end typesafe tRPC procedures. Eliminates manual type syncing between server routes and client, gives React Query caching/loading states for free.

## Decisions

- **Monorepo shared package** (`packages/trpc/`) — router type exported from one place, imported by both server and client
- **Keep Express** as HTTP server; tRPC mounts at `/trpc` via the Express adapter
- **Excluded from migration**: `auth` (will be replaced by Entra ID), `uploads` (multipart, incompatible with tRPC)
- **Client**: `@trpc/react-query` + `@tanstack/react-query` — replaces raw `fetch`, adds caching and loading states
- **Migration strategy**: incremental (one route file at a time) + wrapper pattern (existing service/DB logic untouched)

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

### Procedures (wrapper pattern)
Existing DB/service logic moves unchanged into procedure handlers:
```ts
// packages/trpc/src/routers/tickets.ts
export const ticketsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getTicketsForUser(ctx.user);   // existing service fn
  }),
  close: protectedProcedure
    .input(z.object({ ticketId: z.string(), notes: z.string().optional() }))
    .mutation(async ({ input }) => { ... }),
});
```

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
- Socket.io layer (untouched)
- tRPC subscriptions (Socket.io handles real-time)
- Server-side rendering
