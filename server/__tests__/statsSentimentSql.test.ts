import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Stats sentiment SQL aggregation (#13)', () => {
  const statsSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/stats.ts'), 'utf-8'
  );

  it('does not load all messages into memory for sentiment', () => {
    // The old pattern fetched ALL message rows into liveMessages
    expect(statsSource).not.toMatch(/db\.select\(\)\.from\(messagesTable\)/);
  });

  it('uses SQL AVG for sentiment aggregation', () => {
    // Must use sql`AVG(...)` template or similar aggregate on sentiment column
    expect(statsSource).toMatch(/AVG\(.*sentiment.*\)|avg\(.*sentiment.*\)/i);
  });

  it('uses aggregate query for sentiment grouped by ticket or dept', () => {
    expect(statsSource).toMatch(/sentimentAvg|avgSentiment|sentiment_avg/i);
  });
});
