// Type declarations for server-side modules pulled in via tRPC type inference.
// The client never imports these at runtime — only their types leak through ../server/trpc.
declare module 'cookie';
// server/services/storage.ts leaks into the client compile via tRPC type
// inference. The client never runs it — stub each named type/value as `any` so
// the `import('pkg').X` and `import { X } from 'pkg'` forms in storage.ts
// resolve without forcing us to install the SDK client-side.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module '@azure/storage-blob' {
  export type ContainerClient = any;
  export const BlobServiceClient: any;
}
