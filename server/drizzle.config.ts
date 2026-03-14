import type { Config } from 'drizzle-kit';

export default {
  schema: './db/schema.ts',
  out: './drizzle',
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/murmur',
} satisfies Config;
